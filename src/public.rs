// ABOUTME: Defines the public HTTP surface of the native pastebin service.
// ABOUTME: Isolates host tools and treats uploaded active content as untrusted.
pub fn public_path(path: &str) -> bool {
    if !path.starts_with('/') || path.contains("..") {
        return false;
    }
    let mut decoded = Vec::with_capacity(path.len());
    let mut bytes = path.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let hex = |c: u8| (c as char).to_digit(16).map(|v| v as u8);
            let Some(high) = bytes.next().and_then(hex) else {
                return false;
            };
            let Some(low) = bytes.next().and_then(hex) else {
                return false;
            };
            let value = high * 16 + low;
            if value < 128 {
                return false;
            }
            decoded.push(value);
        } else {
            decoded.push(byte);
        }
    }
    let Ok(decoded) = String::from_utf8(decoded) else {
        return false;
    };
    if !decoded
        .chars()
        .all(|c| c.is_alphanumeric() || "_-/.".contains(c))
    {
        return false;
    }
    let path = decoded.trim_end_matches('/');
    ![
        "/mcp",
        "/upgrade",
        "/plugins",
        "/plugin",
        "/svg2anim",
        "/api/diagnostics",
        "/api/search-doc",
        "/api/nix-skill",
        "/api/git-search",
        "/api/git-index",
        "/api/git-reindex",
        "/git-browse",
        "/git-view",
    ]
    .iter()
    .any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")))
}

pub fn content_policy(path: &str) -> &'static str {
    if [
        "/preview/",
        "/file/",
        "/ipfs/",
        "/render/",
        "/archive-preview/",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
    {
        "sandbox allow-downloads; default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
    } else {
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_paths_reject_host_tools_and_encoded_traversal() {
        for path in [
            "/api/search-doc",
            "/api/diagnostics",
            "/mcp",
            "/api/git-index",
            "/api/git-search",
            "/api/git-reindex",
            "/git-view/repo/file",
            "/git-browse",
            "/api/nix-skill/find",
            "/upgrade",
            "/plugin/screenshot/id",
            "/svg2anim/id",
            "/raw/..%2fetc%2fpasswd",
            "/raw/%252e%252e",
            "/raw/../passwd",
            "/raw/a\\b",
        ] {
            assert!(!public_path(path), "{path}");
        }
        for path in [
            "/",
            "/paste",
            "/paste/20261012_example",
            "/browse",
            "/api/search",
            "/api/split",
            "/upload",
            "/upload-archive",
            "/browse-archive/12345",
            "/raw/bafk1234",
            "/ipfs/Qm1234",
        ] {
            assert!(public_path(path), "{path}");
        }
    }

    #[test]
    fn active_content_has_a_unique_sandboxed_origin() {
        for path in [
            "/preview/paste",
            "/file/upload.html",
            "/ipfs/Qm1234",
            "/render/test.svg",
            "/archive-preview/123/0",
        ] {
            let policy = content_policy(path);
            assert!(policy.contains("sandbox"));
            assert!(!policy.contains("allow-same-origin"));
            assert!(!policy.contains("allow-scripts"));
        }
    }
}
