// ABOUTME: Stores content-addressed UnixFS blocks and reconstructs complete files.
// ABOUTME: Reads and writes the configured local IPFS block store without a daemon.
//! # IPFS Content Addressing
//!
//! Pure Rust IPFS integration for kant-pastebin. Computes content-addressed
//! CIDs and writes blocks directly to the go-ipfs/kubo flatfs block store
//! on the local filesystem — no daemon, no CLI, no HTTP API.
//!
//! ## How it works
//!
//! 1. Content is fed to [`rust_unixfs::file::adder::FileAdder`] which encodes
//!    it as UnixFS dag-pb blocks (the same format `ipfs add` uses).
//! 2. Each block is written to `$IPFS_PATH/blocks/` using go-ipfs flatfs layout:
//!    - Key = base32upper encoding of the block's multihash
//!    - Shard directory = next-to-last 2 characters of the key
//!    - File = `{repo}/blocks/{shard}/{key}.data`
//! 3. The root CID (CIDv0, `Qm...`) is returned and stored in paste headers.
//! 4. A local Kubo daemon can read persisted blocks with `ipfs cat <CID>`.
//!    This does not publish or pin content on the public IPFS network.
//!
//! If the repository does not exist, additions compute CIDs without creating
//! a block store. An existing repository must accept every block write or the
//! addition returns `None`; it never silently falls back to computation only.
//!
//! ## Backends
//!
//! Three [`ContentStore`] implementations are provided:
//! - [`RustStore`] — pure Rust via `rust-unixfs` (default, WASM-compatible)
//! - [`DaslCborStore`] — wraps content in a DASL/CBOR envelope before storing
//! - [`IpfsCliStore`] — shells out to `ipfs add` (fallback)
//!
//! ## DASL/CBOR Integration
//!
//! [`wrap_dasl_cbor`] creates a CBOR envelope containing the content, its IPFS
//! CID, DASL 0xDA51 Monster symmetry address, orbifold coordinates, and Bott
//! periodicity index. This envelope is itself content-addressable.

use ipld_core::cid::Cid;
use rust_unixfs::file::adder::FileAdder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Pluggable content addressing backend.
///
/// Implementations compute a content identifier for arbitrary byte data.
/// The returned string is a valid IPFS CID.
pub trait ContentStore: Send + Sync {
    /// Human-readable backend name (e.g. "rust-unixfs", "ipfs-cli").
    fn name(&self) -> &str;
    /// Add data and return its CID, or `None` on failure.
    fn add(&self, data: &[u8]) -> Option<String>;
}

// === IPFS block storage (go-ipfs/kubo flatfs compatible) ===

/// Resolve the IPFS repo path: `$IPFS_PATH` or `/mnt/data1/ipfs`.
/// Returns `Ok(None)` for a missing repository and propagates other I/O errors.
/// Never falls back to homedirs.
fn ipfs_repo() -> std::io::Result<Option<String>> {
    let repo = std::env::var("IPFS_PATH").unwrap_or_else(|_| "/mnt/data1/ipfs".to_string());
    match std::fs::metadata(&repo) {
        Ok(_) => Ok(Some(repo)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Write a raw block to go-ipfs flatfs.
///
/// Block path: `{repo}/blocks/{shard}/{key}.data`
/// - `key` = base32upper(multihash)
/// - `shard` = next-to-last 2 characters of `key` (go-ipfs sharding scheme)
fn write_block(
    repo: Option<&str>,
    cid: &impl std::fmt::Display,
    block: &[u8],
) -> std::io::Result<()> {
    use std::io::Write;
    let Some(repo) = repo else { return Ok(()) };
    // Parse the CID string with our local Cid type to extract multihash bytes
    let cid_str = cid.to_string();
    let local_cid: Cid = match cid_str.parse() {
        Ok(c) => c,
        Err(error) => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
    };
    let mh_bytes = local_cid.hash().to_bytes();
    let key = data_encoding::BASE32_NOPAD.encode(&mh_bytes);
    let shard = if key.len() >= 3 {
        &key[key.len() - 3..key.len() - 1]
    } else {
        "AA"
    };
    let dir = format!("{}/blocks/{}", repo, shard);
    std::fs::create_dir_all(&dir)?;
    let path = format!("{}/{}.data", dir, key);
    let mut file = std::fs::File::create(&path)?;
    file.write_all(block)?;
    file.sync_all()?;
    log::info!("📦 IPFS block: {}", path);
    Ok(())
}

/// Add content to IPFS via pure Rust. Encodes as UnixFS dag-pb blocks using
/// [`FileAdder`], writes each block to the local flatfs store, and returns
/// the root CID (CIDv0 `Qm...` string).
///
/// For files under 256KB (default chunk size), produces a single leaf block.
/// Larger files are chunked into a balanced Merkle DAG automatically.
/// A missing repository enables compute-only mode. For an existing repository,
/// any block write or sync failure returns `None` instead of claiming a stored CID.
pub fn ipfs_add_bytes(data: &[u8]) -> Option<String> {
    let repo = ipfs_repo().ok()?;
    let mut adder = FileAdder::default();
    let mut root_cid = None;

    let mut offset = 0;
    while offset < data.len() {
        let (blocks, consumed) = adder.push(&data[offset..]);
        if consumed == 0 {
            return None;
        }
        for (cid, block) in blocks {
            write_block(repo.as_deref(), &cid, &block).ok()?;
            root_cid = Some(cid);
        }
        offset += consumed;
    }
    for (cid, block) in adder.finish() {
        write_block(repo.as_deref(), &cid, &block).ok()?;
        root_cid = Some(cid);
    }

    root_cid.map(|c| c.to_string())
}

/// Convenience wrapper: add UTF-8 content to IPFS.
pub fn ipfs_add(content: &str) -> Option<String> {
    ipfs_add_bytes(content.as_bytes())
}

/// Read a raw block from go-ipfs flatfs by CID string.
/// Parses the CID, derives the flatfs path, and reads the block bytes.
fn read_block(cid_str: &str) -> Option<Vec<u8>> {
    let repo = ipfs_repo().ok()??;
    let cid: Cid = cid_str.parse().ok()?;
    let mh_bytes = cid.hash().to_bytes();
    let key = data_encoding::BASE32_NOPAD.encode(&mh_bytes);
    let shard = if key.len() >= 3 {
        &key[key.len() - 3..key.len() - 1]
    } else {
        "AA"
    };
    let path = format!("{}/blocks/{}/{}.data", repo, shard, key);
    let block = std::fs::read(&path).ok()?;
    if cid.hash().code() != 0x12 || Sha256::digest(&block).as_slice() != cid.hash().digest() {
        return None;
    }
    Some(block)
}

/// Reconstruct a bounded UnixFS file from its root block and linked blocks.
pub fn ipfs_cat(cid_str: &str) -> Option<Vec<u8>> {
    use rust_unixfs::file::visit::IdleFileVisit;
    let block = read_block(cid_str)?;
    let (data, size, _, mut visit) = IdleFileVisit::default().start(&block).ok()?;
    if size > 64 * 1024 * 1024 {
        return None;
    }
    let mut content = data.to_vec();
    let mut cache = None;
    let mut blocks = 0;
    while let Some(current) = visit {
        blocks += 1;
        if blocks > 4096 {
            return None;
        }
        let cid = current.pending_links().0.to_string();
        let block = read_block(&cid)?;
        let (data, next) = current.continue_walk(&block, &mut cache).ok()?;
        if content.len() + data.len() > size as usize {
            return None;
        }
        content.extend_from_slice(data);
        visit = next;
    }
    (content.len() == size as usize).then_some(content)
}

/// Quick local content hash (not IPFS-compatible, for dedup only).
pub fn local_cid(data: &[u8]) -> String {
    let hash = Sha256::digest(data);
    format!("bafk{}", hex::encode(&hash[..16]))
}

/// Convert any CID string to CIDv1 base32lower for display.
pub fn cid_to_v1(cid_str: &str) -> String {
    if let Ok(cid) = cid_str.parse::<Cid>() {
        let v1 = Cid::new_v1(cid.codec(), cid.hash().to_owned());
        let bytes = v1.to_bytes();
        format!(
            "b{}",
            data_encoding::BASE32_NOPAD.encode(&bytes).to_lowercase()
        )
    } else {
        cid_str.to_string()
    }
}

// === DASL/CBOR envelope ===

/// CBOR-serializable envelope wrapping content with DASL Monster symmetry metadata.
///
/// Fields:
/// - `prefix`: always `0xDA51`
/// - `dasl_type`: DASL CID type (3 = nested CID)
/// - `orbifold`: coordinates in Z/71 × Z/59 × Z/47 (Monster prime lattice)
/// - `bott`: Bott periodicity index (0–7)
/// - `data`: raw content bytes
/// - `cid`: IPFS CID string
/// - `dasl`: 64-bit DASL address as hex string
#[derive(Serialize, Deserialize)]
pub struct DaslObject {
    pub prefix: u64,
    pub dasl_type: u8,
    pub orbifold: (u64, u64, u64),
    pub bott: u8,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
    pub cid: String,
    pub dasl: String,
}

/// Wrap content in a DASL/CBOR envelope. Returns `(cbor_bytes, ipfs_cid)`.
///
/// The envelope includes the content's IPFS CID, DASL address, orbifold
/// coordinates, and Bott index — bridging IPFS content addressing with
/// Monster group symmetry.
pub fn wrap_dasl_cbor(data: &[u8]) -> (Vec<u8>, String) {
    let cid = ipfs_add_bytes(data).unwrap_or_default();
    let dasl_addr = crate::dasl::dasl_cid(data);
    let (l, m, n) = crate::dasl::orbifold_coords(data);
    let hash = Sha256::digest(data);
    let bott = hash[2] % 8;

    let obj = DaslObject {
        prefix: 0xDA51,
        dasl_type: 3,
        orbifold: (l, m, n),
        bott,
        data: data.to_vec(),
        cid: cid.clone(),
        dasl: dasl_addr,
    };

    let mut cbor = Vec::new();
    ciborium::into_writer(&obj, &mut cbor).unwrap_or_default();
    (cbor, cid)
}

// === Backends ===

/// Pure Rust content store using `rust-unixfs` FileAdder + flatfs writes.
/// Default backend. No external dependencies at runtime.
pub struct RustStore;
impl ContentStore for RustStore {
    fn name(&self) -> &str {
        "rust-unixfs"
    }
    fn add(&self, data: &[u8]) -> Option<String> {
        ipfs_add_bytes(data)
    }
}

/// DASL/CBOR content store. Wraps content in a Monster symmetry envelope
/// before adding to IPFS. The returned CID addresses the envelope, not
/// the raw content.
pub struct DaslCborStore;
impl ContentStore for DaslCborStore {
    fn name(&self) -> &str {
        "dasl-cbor"
    }
    fn add(&self, data: &[u8]) -> Option<String> {
        let (cbor, _) = wrap_dasl_cbor(data);
        ipfs_add_bytes(&cbor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    struct RepoEnvironment(Option<std::ffi::OsString>);

    impl RepoEnvironment {
        fn use_repo(path: &Path) -> Self {
            let previous = std::env::var_os("IPFS_PATH");
            std::env::set_var("IPFS_PATH", path);
            Self(previous)
        }
    }

    impl Drop for RepoEnvironment {
        fn drop(&mut self) {
            if let Some(previous) = &self.0 {
                std::env::set_var("IPFS_PATH", previous);
            } else {
                std::env::remove_var("IPFS_PATH");
            }
        }
    }

    fn stored_block_path(repo: &Path, cid: &str) -> PathBuf {
        let cid: Cid = cid.parse().unwrap();
        let key = data_encoding::BASE32_NOPAD.encode(&cid.hash().to_bytes());
        repo.join("blocks")
            .join(&key[key.len() - 3..key.len() - 1])
            .join(format!("{}.data", key))
    }

    #[test]
    fn stores_small_and_multiblock_files_and_rejects_missing_or_corrupt_blocks() {
        let directory = tempfile::tempdir().unwrap();
        let _environment = RepoEnvironment::use_repo(directory.path());
        let small = b"binary\x00\xfftext";
        let small_cid = ipfs_add_bytes(small).unwrap();
        assert_eq!(ipfs_cat(&small_cid).as_deref(), Some(small.as_slice()));

        let large: Vec<u8> = (0..700_000).map(|index| (index % 251) as u8).collect();
        let cid = ipfs_add_bytes(&large).unwrap();
        assert_eq!(ipfs_cat(&cid).as_deref(), Some(large.as_slice()));
        let root = read_block(&cid).unwrap();
        let (_, _, _, visit) = rust_unixfs::file::visit::IdleFileVisit::default()
            .start(&root)
            .unwrap();
        let linked_cid = visit.unwrap().pending_links().0.to_string();
        let path = stored_block_path(directory.path(), &linked_cid);
        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert!(
            ipfs_cat(&cid).is_none(),
            "missing linked block was accepted"
        );
        std::fs::write(&path, b"corrupt block").unwrap();
        assert!(
            ipfs_cat(&cid).is_none(),
            "corrupt linked block was accepted"
        );
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(ipfs_cat(&cid).as_deref(), Some(large.as_slice()));
        std::fs::write(stored_block_path(directory.path(), &cid), b"corrupt root").unwrap();
        assert!(ipfs_cat(&cid).is_none(), "corrupt root block was accepted");
    }

    #[test]
    fn rejects_failed_writes_to_an_existing_store() {
        let directory = tempfile::tempdir().unwrap();
        let _environment = RepoEnvironment::use_repo(directory.path());
        std::fs::write(directory.path().join("blocks"), b"not a directory").unwrap();
        assert!(
            ipfs_add_bytes(b"must be stored").is_none(),
            "reported CID after block-store write failure"
        );
    }

    #[test]
    fn computes_cids_without_creating_a_missing_store() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        let _environment = RepoEnvironment::use_repo(&missing);
        let cid = ipfs_add_bytes(b"compute only").unwrap();
        assert!(cid.parse::<Cid>().is_ok());
        assert!(!missing.exists());
        assert!(ipfs_cat(&cid).is_none());
    }
}
