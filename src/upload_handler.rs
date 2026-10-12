// ABOUTME: Stores multipart files and text uploads with byte-preserving parsing.
// ABOUTME: Bounds upload size and creates safe, distinct spool filenames.
// Upload file handler — split from 5895-line handlers.rs to avoid edit tool issues.
// Parses multipart/form-data manually (actix-multipart rejects MHT files with
// "Nested multipart is not supported").

use crate::handlers::{archive_name_title, clean_field, file_description, write_index_entry};
use crate::ipfs;
use crate::tagging;
use actix_web::{web, HttpRequest, HttpResponse, Result};
use chrono::Utc;
use log::{error, info};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::{env, fs};

pub(crate) const MAX_UPLOAD_BYTES: usize = 16 * 1024 * 1024;
static UPLOAD_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct MultipartPart<'a> {
    name: String,
    filename: Option<String>,
    data: &'a [u8],
}

fn multipart_parts<'a>(
    body: &'a [u8],
    content_type: &str,
) -> std::result::Result<Vec<MultipartPart<'a>>, String> {
    let boundary = content_type
        .split(';')
        .skip(1)
        .find_map(|parameter| {
            let (name, value) = parameter.trim().split_once('=')?;
            name.eq_ignore_ascii_case("boundary")
                .then(|| value.trim().trim_matches('"'))
        })
        .ok_or_else(|| "missing boundary in multipart Content-Type".to_string())?;
    if boundary.is_empty()
        || boundary.len() > 70
        || !boundary.bytes().all(|b| b.is_ascii_graphic() && b != b'"')
    {
        return Err("invalid multipart boundary".to_string());
    }
    let opening = format!("--{}", boundary);
    let marker = format!("\r\n--{}", boundary);
    let mut remaining = body
        .strip_prefix(opening.as_bytes())
        .ok_or_else(|| "invalid multipart opening".to_string())?;
    let mut parts = Vec::new();
    loop {
        if remaining == b"--" || remaining.starts_with(b"--\r\n") {
            return Ok(parts);
        }
        remaining = remaining
            .strip_prefix(b"\r\n")
            .ok_or_else(|| "invalid multipart delimiter".to_string())?;
        let header_end = remaining
            .windows(4)
            .position(|bytes| bytes == b"\r\n\r\n")
            .ok_or_else(|| "missing multipart headers".to_string())?;
        if header_end > 8192 || parts.len() >= 32 {
            return Err("multipart header or part limit exceeded".to_string());
        }
        let headers = std::str::from_utf8(&remaining[..header_end])
            .map_err(|_| "invalid multipart headers".to_string())?;
        let disposition = headers
            .split("\r\n")
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-disposition")
                    .then_some(value.trim())
            })
            .ok_or_else(|| "missing content disposition".to_string())?;
        let mut parameters = disposition.split(';');
        if !parameters
            .next()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case("form-data")
        {
            return Err("invalid content disposition".to_string());
        }
        let mut name = None;
        let mut filename = None;
        for parameter in parameters {
            if let Some((key, value)) = parameter.trim().split_once('=') {
                let value = value.trim().trim_matches('"').to_string();
                match key.trim() {
                    "name" => name = Some(value),
                    "filename" => filename = Some(value),
                    _ => {}
                }
            }
        }
        let data = &remaining[header_end + 4..];
        let end = data
            .windows(marker.len())
            .enumerate()
            .find_map(|(index, bytes)| {
                if bytes != marker.as_bytes() {
                    return None;
                }
                let suffix = &data[index + marker.len()..];
                (suffix.starts_with(b"\r\n") || suffix == b"--" || suffix.starts_with(b"--\r\n"))
                    .then_some(index)
            })
            .ok_or_else(|| "missing multipart closing boundary".to_string())?;
        parts.push(MultipartPart {
            name: name.ok_or_else(|| "missing multipart field name".to_string())?,
            filename,
            data: &data[..end],
        });
        remaining = &data[end + marker.len()..];
    }
}

pub(crate) fn safe_extension(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| {
            !extension.is_empty()
                && extension.len() <= 16
                && extension.bytes().all(|b| b.is_ascii_alphanumeric())
        })
        .unwrap_or("bin")
        .to_ascii_lowercase()
}

pub(crate) fn upload_filename(timestamp: &str, title: &str, extension: &str) -> String {
    let slug = tagging::slugify(title);
    let mut end = slug.len().min(80);
    while !slug.is_char_boundary(end) {
        end -= 1;
    }
    let sequence = UPLOAD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "{}_{}_{:x}_{:x}.{}",
        timestamp,
        &slug[..end],
        Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        sequence,
        extension
    )
}

/// POST /upload - Upload file (multipart or raw body)
pub async fn upload_file(req: HttpRequest, body: web::Bytes) -> Result<HttpResponse> {
    if body.len() > MAX_UPLOAD_BYTES {
        return Ok(HttpResponse::PayloadTooLarge()
            .json(serde_json::json!({"error": "upload exceeds 16 MiB"})));
    }
    let uucp_dir = env::var("UUCP_SPOOL").unwrap_or_else(|_| "/var/spool/uucp".to_string());
    let ts = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let mut file_data: Vec<u8> = Vec::new();
    let mut orig_name = String::new();
    let mut user_title = String::new();
    let mut user_description = String::new();
    let mut content_text = String::new();

    // Parse multipart manually — actix-multipart streaming parser rejects
    // MHT files (internal multipart/* headers) with "Nested multipart".
    let ct = req
        .headers()
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if ct.starts_with("multipart/form-data") {
        let parts = match multipart_parts(&body, &ct) {
            Ok(parts) => parts,
            Err(error) => {
                return Ok(HttpResponse::BadRequest().json(serde_json::json!({"error": error})))
            }
        };
        for part in parts {
            match part.name.as_str() {
                "file" => {
                    orig_name = part.filename.unwrap_or_else(|| "upload".to_string());
                    file_data = part.data.to_vec();
                }
                "content" => content_text = String::from_utf8_lossy(part.data).to_string(),
                "title" => user_title = clean_field(&String::from_utf8_lossy(part.data)),
                "description" => {
                    user_description = clean_field(&String::from_utf8_lossy(part.data))
                }
                _ => {}
            }
        }
    } else {
        // Not multipart — try JSON body
        let bod = String::from_utf8_lossy(&body).to_string();
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&bod) {
            content_text = j
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            user_title = j
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            user_description = j
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }
    }

    if file_data.is_empty() && content_text.is_empty() {
        let resp = serde_json::json!({"error": "no file or content"});
        return Ok(HttpResponse::BadRequest().json(resp));
    }

    if file_data.is_empty() && !content_text.is_empty() {
        file_data = content_text.clone().into_bytes();
        orig_name = if user_title.is_empty() {
            "content.txt".to_string()
        } else {
            user_title.clone()
        };
    }

    if file_data.len() > MAX_UPLOAD_BYTES {
        return Ok(HttpResponse::PayloadTooLarge()
            .json(serde_json::json!({"error": "upload exceeds 16 MiB"})));
    }

    let ext = safe_extension(&orig_name);
    let mime = if orig_name.to_lowercase().ends_with(".mth")
        || orig_name.to_lowercase().ends_with(".mht")
        || orig_name.to_lowercase().ends_with(".html")
    {
        "text/html"
            .parse::<mime_guess::Mime>()
            .unwrap_or_else(|_| mime_guess::from_ext(&ext).first_or_octet_stream())
    } else {
        mime_guess::from_ext(&ext).first_or_octet_stream()
    };
    let mime_str = mime.to_string();

    let save_title = if user_title.is_empty() {
        archive_name_title(&orig_name)
    } else {
        user_title.clone()
    };

    let filename = upload_filename(&ts, &save_title, &ext);
    let id = filename
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(&filename)
        .to_string();
    let uucp = format!("{}/{}", uucp_dir, filename);

    let write_result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&uucp)
        .and_then(|mut file| file.write_all(&file_data).and_then(|()| file.sync_all()));
    if let Err(e) = write_result {
        error!("[upload] failed to write {}: {}", uucp, e);
        return Ok(HttpResponse::InternalServerError()
            .json(serde_json::json!({"error": "upload could not be stored"})));
    }
    info!("[upload] saved file: {} ({} bytes)", uucp, file_data.len());

    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash = hasher.finalize();
    let local_cid = format!("bafk{}", hex::encode(&hash[..16]));
    let witness = hex::encode(&hash);
    let ipfs_cid = ipfs::ipfs_add_bytes(&file_data);

    let final_title = save_title.clone();
    let final_description = if user_description.is_empty() {
        file_description(&orig_name, &mime_str, file_data.len(), &file_data)
    } else {
        user_description.clone()
    };

    let cid_file = format!("{}/{}.cid", uucp_dir, local_cid);
    // Content-addressed dedup: the same content hashes to the same CID.
    // Keep the FIRST id for a given CID — overwriting it would make the
    // second post resolve to the wrong id (the duplicate-post glitch).
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&cid_file)
    {
        Ok(mut file) => {
            file.write_all(id.as_bytes())
                .map_err(actix_web::error::ErrorInternalServerError)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            info!("[upload] duplicate content CID {local_cid} — keeping first id, not overwriting");
        }
        Err(error) => {
            error!("[upload] could not store CID: {}", error);
            return Err(actix_web::error::ErrorInternalServerError(
                "upload CID could not be stored",
            ));
        }
    }

    write_index_entry(
        &uucp_dir,
        &id,
        &final_title,
        Some(&final_description),
        vec!["upload".to_string(), ext.to_string()],
        &local_cid,
        &witness,
        &filename,
        file_data.len(),
        ipfs_cid.clone(),
        None,
        None,
    )
    .map_err(actix_web::error::ErrorInternalServerError)?;

    info!("[upload] completed: id={} title='{}'", id, final_title);

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "id": id,
        "filename": filename,
        "title": final_title,
        "description": final_description,
        "cid": local_cid,
        "ipfs_cid": ipfs_cid,
        "witness": witness,
        "mime": mime_str,
        "size": file_data.len(),
        "url": format!("/paste/{}", id),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{body::to_bytes, http::StatusCode, test::TestRequest};

    #[test]
    fn extensions_cannot_escape_the_spool() {
        for name in [
            "../no-extension",
            "file./../../outside",
            "file.\\outside",
            "noextension",
            "file.html/other",
            "file.",
        ] {
            assert_eq!(safe_extension(name), "bin", "accepted {name:?}");
        }
        assert_eq!(safe_extension("document.TXT"), "txt");
        let filename = upload_filename("20261012_000000", &"文".repeat(200), "txt");
        assert!(filename.len() < 200);
        assert!(!filename.contains('/'));
    }

    #[test]
    fn multipart_supports_quoted_boundaries_and_embedded_boundary_prefixes() {
        let bytes = b"--example\r\nContent-Disposition: form-data; name=\"file\"; filename=\"archive.mht\"\r\nContent-Type: multipart/related\r\n\r\n\xff\r\n--example-prefix\r\n--example--suffix\r\n\r\n--example--\r\n";
        let parts = multipart_parts(bytes, "multipart/form-data; boundary=\"example\"").unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].name, "file");
        assert_eq!(
            parts[0].data,
            b"\xff\r\n--example-prefix\r\n--example--suffix\r\n"
        );
        assert_eq!(parts[0].filename.as_deref(), Some("archive.mht"));
        assert!(multipart_parts(bytes, "multipart/form-data").is_err());
        assert!(
            multipart_parts(b"--example\r\n", "multipart/form-data; boundary=example").is_err()
        );
    }

    #[actix_web::test]
    async fn rejects_uploads_larger_than_16_mib() {
        let request = TestRequest::post().to_http_request();
        let response = upload_file(request, web::Bytes::from(vec![0; 16 * 1024 * 1024 + 1]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[actix_web::test]
    async fn preserves_binary_multipart_and_never_overwrites_uploads() {
        let spool = tempfile::tempdir().unwrap();
        let previous = env::var_os("UUCP_SPOOL");
        let previous_ipfs = env::var_os("IPFS_PATH");
        env::set_var("UUCP_SPOOL", spool.path());
        env::set_var("IPFS_PATH", spool.path().join("ipfs"));
        let binary = b"\x00\xffbinary\r\n--not-the-boundary\r\n--";
        let mut body = b"--test-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sample.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec();
        body.extend_from_slice(binary);
        body.extend_from_slice(b"\r\n--test-boundary--\r\n");
        let mut filenames = Vec::new();
        for _ in 0..2 {
            let request = TestRequest::post()
                .insert_header((
                    "Content-Type",
                    "multipart/form-data; boundary=test-boundary",
                ))
                .to_http_request();
            let response = upload_file(request, web::Bytes::from(body.clone()))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let value: serde_json::Value =
                serde_json::from_slice(&to_bytes(response.into_body()).await.unwrap()).unwrap();
            let filename = value["filename"].as_str().unwrap().to_string();
            assert_eq!(fs::read(spool.path().join(&filename)).unwrap(), binary);
            filenames.push(filename);
        }
        assert_ne!(filenames[0], filenames[1]);
        if let Some(value) = previous {
            env::set_var("UUCP_SPOOL", value);
        } else {
            env::remove_var("UUCP_SPOOL");
        }
        if let Some(value) = previous_ipfs {
            env::set_var("IPFS_PATH", value);
        } else {
            env::remove_var("IPFS_PATH");
        }
    }
}
