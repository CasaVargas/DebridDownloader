//! App-level event seam, so command bodies can notify the UI without an `AppHandle`.
//!
//! The desktop app emits through Tauri ([`crate::engine_host::TauriEvents`]); a headless host can
//! fan events out over HTTP, and tests record them. The engine has its own, narrower
//! [`crate::engine::EventSink`].

use serde::Serialize;
use serde_json::Value;

pub trait AppEvents: Send + Sync {
    /// Send `payload` to every listener of `event` (fire-and-forget).
    fn emit_json(&self, event: &str, payload: Value);
}

impl dyn AppEvents + '_ {
    /// Serialize `payload` and emit it; a payload that can't be serialized is logged and dropped.
    pub fn emit<T: Serialize + ?Sized>(&self, event: &str, payload: &T) {
        match serde_json::to_value(payload) {
            Ok(value) => self.emit_json(event, value),
            Err(e) => log::warn!("Dropped '{}' event: {}", event, e),
        }
    }
}

/// Keeps every event, for tests.
#[cfg(test)]
#[derive(Default)]
pub struct RecordingEvents {
    pub events: std::sync::Mutex<Vec<(String, Value)>>,
}

#[cfg(test)]
impl AppEvents for RecordingEvents {
    fn emit_json(&self, event: &str, payload: Value) {
        self.events.lock().unwrap().push((event.to_string(), payload));
    }
}

#[cfg(test)]
impl RecordingEvents {
    /// Payloads emitted under `event`, in order.
    pub fn named(&self, event: &str) -> Vec<Value> {
        self.events.lock().unwrap().iter().filter(|(e, _)| e == event).map(|(_, v)| v.clone()).collect()
    }
}
