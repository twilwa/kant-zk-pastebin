// ABOUTME: Exposes the native pastebin modules for integrations and tests.
// ABOUTME: Shares storage, rendering, and upload behavior with the server binary.
// Modules
pub mod api;
pub mod archive;
pub mod dasl;
pub mod git_mount;
pub mod handlers;
pub mod ipfs;
pub mod mcp_server;
pub mod model;
pub mod nix_skill;
pub mod plugin;
pub mod plugins;
pub mod rename;
pub mod share;
pub mod splitter;
pub mod storage;
pub mod summary;
pub mod tagging;
pub mod upload_handler;
pub mod view;
