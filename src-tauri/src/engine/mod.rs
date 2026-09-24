//! Download engine. Must stay free of Tauri types (see specs/2026-09-23-resilient-download-engine-design.md).
#![allow(dead_code)] // removed in Task 10 once the host uses everything

pub mod events;
pub mod limiter;
pub mod refresh;
pub mod remote;
pub mod segment;
pub mod store;
pub mod transfer;
pub mod types;

#[cfg(test)]
mod tests;

pub use events::{EngineEvent, EventSink, JobView};
pub use refresh::{LinkRefresher, RefreshError, RefreshedLink};
pub use remote::{NoRemote, RemoteOutcome, RemoteRunner};
pub use types::*;
