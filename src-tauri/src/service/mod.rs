//! Command bodies, free of Tauri types.
//!
//! Each function takes the shared [`AppState`](crate::state::AppState) plus whichever seams it
//! needs ([`Persistence`](crate::persistence::Persistence), [`Secrets`](crate::secrets::Secrets),
//! [`AppEvents`](crate::events::AppEvents)). The Tauri command handlers in
//! `crate::commands` are thin wrappers that unpack Tauri state and call these, so a headless
//! host can call the same functions.

pub mod auth;
pub mod backup;
pub mod downloads;
pub mod search;
pub mod settings;
pub mod torrents;
pub mod watchlist;

#[cfg(test)]
mod tests;
