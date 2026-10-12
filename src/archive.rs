// ABOUTME: Lists archive contents and previews text across supported compression formats.
// ABOUTME: Bounds decompression work, entry counts, and nested archive depth.
// Archive — extract and list contents of compressed archives
// Supports: .tar.gz, .tar.bz2, .tar.xz, .zip, .gz, .bz2, .xz

use std::cell::Cell;
use std::io::Read;
use std::rc::Rc;

const MAX_EXTRACTED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 1024;
const MAX_NESTING: usize = 4;
const MAX_PREVIEW_BYTES: u64 = 1024 * 1024;

#[derive(Clone)]
struct ExtractionBudget {
    remaining_bytes: Rc<Cell<u64>>,
    remaining_entries: Rc<Cell<usize>>,
}

impl ExtractionBudget {
    fn new() -> Self {
        Self {
            remaining_bytes: Rc::new(Cell::new(MAX_EXTRACTED_BYTES)),
            remaining_entries: Rc::new(Cell::new(MAX_ENTRIES)),
        }
    }

    fn entry(&self) -> Result<(), String> {
        let remaining = self.remaining_entries.get();
        if remaining == 0 {
            return Err("Archive exceeds 1024 entries".to_string());
        }
        self.remaining_entries.set(remaining - 1);
        Ok(())
    }

    fn reader<R: Read>(&self, reader: R) -> BudgetReader<R> {
        BudgetReader {
            reader,
            remaining: self.remaining_bytes.clone(),
        }
    }
}

struct BudgetReader<R> {
    reader: R,
    remaining: Rc<Cell<u64>>,
}

impl<R: Read> Read for BudgetReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let remaining = self.remaining.get();
        let limit = buf.len().min(remaining.saturating_add(1) as usize);
        let count = self.reader.read(&mut buf[..limit])?;
        if count as u64 > remaining {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Archive exceeds 64 MiB decompression limit",
            ));
        }
        self.remaining.set(remaining - count as u64);
        Ok(count)
    }
}

fn read_entry<R: Read>(reader: &mut R, size: u64) -> Result<Option<Vec<u8>>, String> {
    if size > MAX_EXTRACTED_BYTES {
        return Err("Archive exceeds 64 MiB decompression limit".to_string());
    }
    if size < MAX_PREVIEW_BYTES {
        let mut raw = Vec::new();
        reader
            .read_to_end(&mut raw)
            .map_err(|e| format!("Archive read error: {}", e))?;
        Ok(Some(raw))
    } else {
        std::io::copy(reader, &mut std::io::sink())
            .map_err(|e| format!("Archive read error: {}", e))?;
        Ok(None)
    }
}

/// Info about a single file within an archive
#[derive(serde::Serialize, Clone)]
pub struct ArchiveEntry {
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub content: Option<String>,
}

/// Summary of the extracted archive
#[derive(serde::Serialize)]
pub struct ArchiveResult {
    pub filename: String,
    pub title: String,
    pub description: String,
    pub entries: Vec<ArchiveEntry>,
    pub total_size: u64,
    pub entry_count: usize,
}

/// Detect format from filename extension and extract
pub fn extract(data: &[u8], filename: &str) -> Result<ArchiveResult, String> {
    extract_with_budget(data, filename, &ExtractionBudget::new(), 0)
}

fn extract_with_budget(
    data: &[u8],
    filename: &str,
    budget: &ExtractionBudget,
    depth: usize,
) -> Result<ArchiveResult, String> {
    if depth > MAX_NESTING {
        return Err("Archive exceeds four nested levels".to_string());
    }
    let lower = filename.to_lowercase();

    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_tar_gz(data, filename, budget, depth)
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") || lower.ends_with(".tbz") {
        extract_tar_bz2(data, filename, budget, depth)
    } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
        extract_tar_xz(data, filename, budget, depth)
    } else if lower.ends_with(".tar") {
        extract_tar(data, filename, budget, depth)
    } else if lower.ends_with(".zip") {
        extract_zip(data, filename, budget, depth)
    } else if lower.ends_with(".gz") {
        extract_single_compressed(data, filename, PhantomData::<GzipDecoder>, budget)
    } else if lower.ends_with(".bz2") {
        extract_single_compressed(data, filename, PhantomData::<Bzip2Decoder>, budget)
    } else if lower.ends_with(".xz") {
        extract_single_compressed(data, filename, PhantomData::<XzDecoder>, budget)
    } else {
        Err(format!("Unsupported archive format: {}", filename))
    }
}

// ── Decoder wrappers (trait to unify single-stream decompression) ──────

trait Decoder: Read + Sized {
    fn new(r: Box<dyn Read>) -> Result<Self, String>;
}

struct GzipDecoder(flate2::read::GzDecoder<Box<dyn Read>>);
impl Decoder for GzipDecoder {
    fn new(r: Box<dyn Read>) -> Result<Self, String> {
        Ok(GzipDecoder(flate2::read::GzDecoder::new(r)))
    }
}
impl Read for GzipDecoder {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buf)
    }
}

struct Bzip2Decoder(bzip2::read::BzDecoder<Box<dyn Read>>);
impl Decoder for Bzip2Decoder {
    fn new(r: Box<dyn Read>) -> Result<Self, String> {
        Ok(Bzip2Decoder(bzip2::read::BzDecoder::new(r)))
    }
}
impl Read for Bzip2Decoder {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buf)
    }
}

struct XzDecoder(xz2::read::XzDecoder<Box<dyn Read>>);
impl Decoder for XzDecoder {
    fn new(r: Box<dyn Read>) -> Result<Self, String> {
        Ok(XzDecoder(xz2::read::XzDecoder::new(r)))
    }
}
impl Read for XzDecoder {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buf)
    }
}

use std::marker::PhantomData;

/// Decompress a single-stream file (.gz, .bz2, .xz) — yields one entry.
fn extract_single_compressed<D: Decoder>(
    data: &[u8],
    filename: &str,
    _decoder: PhantomData<D>,
    budget: &ExtractionBudget,
) -> Result<ArchiveResult, String> {
    let owned = data.to_vec();
    let reader: Box<dyn Read> = Box::new(std::io::Cursor::new(owned));
    budget.entry()?;
    let dec = D::new(reader).map_err(|e| format!("Decompress error: {}", e))?;
    let mut dec = budget.reader(dec);

    let mut content = Vec::new();
    dec.read_to_end(&mut content)
        .map_err(|e| format!("Read error: {}", e))?;

    // Strip the compression extension for the output name
    let out_name = filename
        .rsplit_once('.')
        .map(|(base, _)| {
            // For .tar.gz → strip .gz → already handled by tar; for .gz → strip .gz
            if base.ends_with(".tar") {
                base.to_string()
            } else {
                filename
                    .trim_end_matches(".gz")
                    .trim_end_matches(".bz2")
                    .trim_end_matches(".xz")
                    .to_string()
            }
        })
        .unwrap_or_else(|| filename.to_string());

    let is_text = content.windows(4).all(|w| {
        // Very simple heuristic: if first 4 bytes are all ASCII printable
        w.iter()
            .all(|&b| b.is_ascii_graphic() || b == b'\n' || b == b'\r' || b == b'\t' || b == b' ')
    }) || content.is_empty();

    let entry_content = if is_text {
        Some(String::from_utf8_lossy(&content).to_string())
    } else {
        None
    };

    let title = filename
        .trim_end_matches(".gz")
        .trim_end_matches(".bz2")
        .trim_end_matches(".xz")
        .trim_end_matches(".tar")
        .rsplit('/')
        .next()
        .unwrap_or(filename)
        .trim_end_matches('.')
        .to_string();

    Ok(ArchiveResult {
        filename: filename.to_string(),
        title,
        description: format!("Single compressed file extracted from {}", filename),
        entries: vec![ArchiveEntry {
            path: out_name,
            size: content.len() as u64,
            is_dir: false,
            content: entry_content,
        }],
        total_size: content.len() as u64,
        entry_count: 1,
    })
}

// ── Tar extraction (with various compressions) ─────────────────────────

fn extract_tar(
    data: &[u8],
    filename: &str,
    budget: &ExtractionBudget,
    depth: usize,
) -> Result<ArchiveResult, String> {
    // &[u8] implements Read — pass directly without boxing
    extract_tar_from_reader(data, filename, budget, depth)
}

fn extract_tar_gz(
    data: &[u8],
    filename: &str,
    budget: &ExtractionBudget,
    depth: usize,
) -> Result<ArchiveResult, String> {
    let dec = flate2::read::GzDecoder::new(data);
    extract_tar_from_reader(dec, filename, budget, depth)
}

fn extract_tar_bz2(
    data: &[u8],
    filename: &str,
    budget: &ExtractionBudget,
    depth: usize,
) -> Result<ArchiveResult, String> {
    // Copy to owned Vec to avoid lifetime issues with the decoder
    let owned = data.to_vec();
    let dec = bzip2::read::BzDecoder::new(std::io::Cursor::new(owned));
    extract_tar_from_reader(dec, filename, budget, depth)
}

fn extract_tar_xz(
    data: &[u8],
    filename: &str,
    budget: &ExtractionBudget,
    depth: usize,
) -> Result<ArchiveResult, String> {
    // Copy to owned Vec to avoid lifetime issues with the decoder
    let owned = data.to_vec();
    let dec = xz2::read::XzDecoder::new(std::io::Cursor::new(owned));
    extract_tar_from_reader(dec, filename, budget, depth)
}

fn extract_tar_from_reader<R: Read>(
    reader: R,
    filename: &str,
    budget: &ExtractionBudget,
    depth: usize,
) -> Result<ArchiveResult, String> {
    let mut archive = tar::Archive::new(budget.reader(reader));
    let mut entries = Vec::new();
    let mut total_size = 0u64;

    for entry in archive.entries().map_err(|e| format!("Tar error: {}", e))? {
        let mut entry = entry.map_err(|e| format!("Tar entry error: {}", e))?;
        budget.entry()?;
        let path = entry
            .path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        let size = entry.size();
        let is_dir = entry.header().entry_type().is_dir();

        // Skip directory entries in content listing
        if is_dir {
            entries.push(ArchiveEntry {
                path,
                size: 0,
                is_dir: true,
                content: None,
            });
            continue;
        }

        total_size += size;

        // Read content for all files (smallish files only) — no binary
        // filter: preserve every file's content (lossy for binary).
        let raw = read_entry(&mut entry, size)?;
        let content = raw
            .as_ref()
            .map(|bytes| String::from_utf8_lossy(bytes).to_string());

        // Recursive unpack: nested archives (.tar.gz/.tgz/.zip inside)
        let lower_path = path.to_lowercase();
        let is_nested = lower_path.ends_with(".tar.gz")
            || lower_path.ends_with(".tgz")
            || lower_path.ends_with(".tar.bz2")
            || lower_path.ends_with(".tar.xz")
            || lower_path.ends_with(".zip");
        if is_nested {
            if let Some(raw) = raw.as_ref().filter(|bytes| !bytes.is_empty()) {
                let nested = extract_with_budget(raw, &path, budget, depth + 1)?;
                for mut ne in nested.entries {
                    ne.path = format!("{}/{}", path, ne.path);
                    entries.push(ne);
                }
                continue;
            }
        }

        entries.push(ArchiveEntry {
            path,
            size,
            is_dir: false,
            content,
        });
    }

    let title = filename
        .rsplit('/')
        .next()
        .unwrap_or(filename)
        .trim_end_matches(".tar.gz")
        .trim_end_matches(".tgz")
        .trim_end_matches(".tar.bz2")
        .trim_end_matches(".tbz2")
        .trim_end_matches(".tbz")
        .trim_end_matches(".tar.xz")
        .trim_end_matches(".txz")
        .trim_end_matches(".tar")
        .trim_end_matches('.')
        .to_string();

    Ok(ArchiveResult {
        filename: filename.to_string(),
        title,
        description: format!(
            "Archive extracted from {} with {} entries",
            filename,
            entries.len()
        ),
        entry_count: entries.len(),
        total_size,
        entries,
    })
}

// ── Zip extraction ─────────────────────────────────────────────────────

fn extract_zip(
    data: &[u8],
    filename: &str,
    budget: &ExtractionBudget,
    _depth: usize,
) -> Result<ArchiveResult, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| format!("Zip error: {}", e))?;

    let mut entries = Vec::new();
    let mut total_size = 0u64;

    if archive.len() > budget.remaining_entries.get() {
        return Err("Archive exceeds 1024 entries".to_string());
    }
    for i in 0..archive.len() {
        budget.entry()?;
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry {}: {}", i, e))?;

        let path = file.name().to_string();
        let is_dir = file.is_dir();
        let size = file.size();

        if is_dir {
            entries.push(ArchiveEntry {
                path,
                size: 0,
                is_dir: true,
                content: None,
            });
            continue;
        }

        total_size += size;

        let raw = read_entry(&mut budget.reader(&mut file), size)?;
        let content = raw
            .as_ref()
            .map(|bytes| String::from_utf8_lossy(bytes).to_string());

        entries.push(ArchiveEntry {
            path,
            size,
            is_dir: false,
            content,
        });
    }

    let title = filename
        .rsplit('/')
        .next()
        .unwrap_or(filename)
        .trim_end_matches(".zip")
        .trim_end_matches('.')
        .to_string();

    Ok(ArchiveResult {
        filename: filename.to_string(),
        title,
        description: format!(
            "Zip archive extracted from {} with {} entries",
            filename,
            entries.len()
        ),
        entry_count: entries.len(),
        total_size,
        entries,
    })
}

// ── Utility ────────────────────────────────────────────────────────────

/// Simple heuristic: if >90% of bytes are ASCII printable or whitespace, treat as text.
fn guess_is_text(buf: &[u8]) -> bool {
    if buf.is_empty() {
        return true;
    }
    let printable = buf
        .iter()
        .filter(|&&b| b.is_ascii_graphic() || b == b'\n' || b == b'\r' || b == b'\t' || b == b' ')
        .count();
    printable > (buf.len() * 9 / 10)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tar_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (name, bytes) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o600);
            header.set_cksum();
            builder.append_data(&mut header, name, *bytes).unwrap();
        }
        builder.into_inner().unwrap()
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn refuses_more_than_1024_entries() {
        let files = vec![("empty.txt", &b""[..]); 1025];
        assert!(extract(&tar_bytes(&files), "many.tar").is_err());
    }

    #[test]
    fn refuses_more_than_four_nested_archives() {
        let mut bytes = gzip(&tar_bytes(&[("message.txt", b"hello")]));
        for _ in 0..5 {
            bytes = gzip(&tar_bytes(&[("nested.tar.gz", &bytes)]));
        }
        assert!(extract(&bytes, "nested.tar.gz").is_err());
    }

    #[test]
    fn refuses_single_stream_expansion_over_64_mib() {
        let bytes = vec![b'a'; 64 * 1024 * 1024 + 1];
        assert!(extract(&gzip(&bytes), "large.txt.gz").is_err());
    }

    #[test]
    fn shared_budget_counts_actual_reads_and_nested_entries() {
        let budget = ExtractionBudget::new();
        budget.remaining_bytes.set(3);
        let mut reader = budget.reader(&b"1234"[..]);
        assert!(reader.read_to_end(&mut Vec::new()).is_err());

        let nested = gzip(&tar_bytes(&[("message.txt", b"hello")]));
        let outer = tar_bytes(&[("a.tar.gz", &nested), ("b.tar.gz", &nested)]);
        let budget = ExtractionBudget::new();
        budget.remaining_entries.set(3);
        assert!(extract_with_budget(&outer, "outer.tar", &budget, 0).is_err());

        let budget = ExtractionBudget::new();
        budget.remaining_bytes.set(outer.len() as u64);
        assert!(extract_with_budget(&outer, "outer.tar", &budget, 0).is_err());
    }

    #[test]
    fn preserves_supported_archive_formats() {
        let text = b"hello archive\n";
        let tar = tar_bytes(&[("message.txt", text)]);
        let mut bz_tar = bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast());
        bz_tar.write_all(&tar).unwrap();
        let mut bz_text = bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast());
        bz_text.write_all(text).unwrap();
        let mut xz_tar = xz2::write::XzEncoder::new(Vec::new(), 1);
        xz_tar.write_all(&tar).unwrap();
        let mut xz_text = xz2::write::XzEncoder::new(Vec::new(), 1);
        xz_text.write_all(text).unwrap();
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file("message.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(text).unwrap();
        let formats = [
            ("a.tar", tar.clone()),
            ("a.tar.gz", gzip(&tar)),
            ("a.txt.gz", gzip(text)),
            ("a.tar.bz2", bz_tar.finish().unwrap()),
            ("a.txt.bz2", bz_text.finish().unwrap()),
            ("a.tar.xz", xz_tar.finish().unwrap()),
            ("a.txt.xz", xz_text.finish().unwrap()),
            ("a.zip", zip.finish().unwrap().into_inner()),
        ];
        for (name, bytes) in formats {
            let result = extract(&bytes, name).unwrap();
            assert_eq!(result.entry_count, 1);
            assert_eq!(
                result.entries[0].content.as_deref(),
                Some("hello archive\n")
            );
        }
    }
}
