// ABOUTME: Loads and saves paste text in the configured spool directory.
// ABOUTME: Rejects paste identifiers that could escape the spool directory.
// Storage - Load/save pastes from UUCP/IPFS/consumer service
use std::env;
use std::fs;

pub fn valid_paste_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

pub fn load_content(id: &str) -> Option<String> {
    if !valid_paste_id(id) {
        return None;
    }
    let uucp_dir = env::var("UUCP_SPOOL").unwrap_or_else(|_| "/var/spool/uucp".to_string());
    let filename = format!("{}/{}.txt", uucp_dir, id);

    if let Ok(content) = fs::read_to_string(&filename) {
        return Some(content);
    }

    None
}

pub fn save_content(id: &str, content: &str) -> Result<(), std::io::Error> {
    if !valid_paste_id(id) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid paste id",
        ));
    }
    let uucp_dir = env::var("UUCP_SPOOL").unwrap_or_else(|_| "/var/spool/uucp".to_string());
    let filename = format!("{}/{}.txt", uucp_dir, id);

    fs::write(&filename, content)?;
    Ok(())
}

fn load_from_ipfs(id: &str) -> Option<String> {
    None
}

fn save_to_ipfs(_content: &str) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn accepts_paste_identifiers() {
        for id in ["abc", "20261012_123456_title", "text-code", "a123"] {
            assert!(super::valid_paste_id(id));
        }
    }

    #[test]
    fn rejects_path_traversal_before_accessing_storage() {
        for id in [
            "../escape",
            "/tmp/escape",
            "..\\escape",
            ".",
            "..",
            "",
            "a/b",
            "a\\b",
        ] {
            assert!(super::load_content(id).is_none(), "accepted {id:?}");
            let error = super::save_content(id, "blocked").expect_err("unsafe id accepted");
            assert_eq!(
                error.kind(),
                std::io::ErrorKind::InvalidInput,
                "accepted {id:?}"
            );
        }
    }
}
