//! Plain-language messages for Real-Debrid API error codes
//! (https://api.real-debrid.com/ → "Error codes").

use crate::providers::types::humanize_api_message;

/// Message shown to the user for a Real-Debrid API error.
pub fn rd_error_message(code: Option<i64>, raw: &str) -> String {
    let known = match code {
        Some(5) | Some(34) => Some("Too many requests to Real-Debrid. Wait a moment and try again"),
        Some(8) => Some("Your Real-Debrid session expired. Sign in again"),
        Some(9) => Some("This needs a Real-Debrid premium account"),
        Some(14) => Some("Your Real-Debrid account is locked"),
        Some(16) => Some("Real-Debrid doesn't support this host"),
        Some(17) | Some(19) => Some("This host is temporarily unavailable on Real-Debrid. Try again later"),
        Some(21) => Some("Too many active downloads on your Real-Debrid account"),
        Some(22) => Some("Real-Debrid doesn't allow requests from your IP address"),
        Some(23) => Some("You've used up your Real-Debrid traffic"),
        Some(24) => Some("This file is unavailable on Real-Debrid"),
        Some(25) => Some("Real-Debrid is unavailable right now. Try again later"),
        Some(29) => Some("Torrent is too big for Real-Debrid"),
        Some(30) => Some("This isn't a valid torrent file"),
        Some(33) => Some("This torrent is already in your list"),
        Some(35) => Some("Real-Debrid won't host this file: it's been blocked for copyright"),
        Some(36) => Some("You've reached Real-Debrid's fair-usage limit"),
        _ => None,
    };
    if let Some(m) = known {
        return m.to_string();
    }
    let tidied = humanize_api_message(raw);
    if tidied.is_empty() {
        "Real-Debrid returned an error".to_string()
    } else {
        tidied
    }
}

#[cfg(test)]
mod tests {
    use super::rd_error_message;
    use crate::providers::types::ProviderError;

    #[test]
    fn known_codes_get_plain_messages() {
        assert_eq!(
            rd_error_message(Some(35), "infringing_file"),
            "Real-Debrid won't host this file: it's been blocked for copyright"
        );
        assert_eq!(rd_error_message(Some(8), "bad_token"), "Your Real-Debrid session expired. Sign in again");
        assert_eq!(rd_error_message(Some(33), "torrent_already_active"), "This torrent is already in your list");
        assert_eq!(rd_error_message(Some(30), "torrent_file_invalid"), "This isn't a valid torrent file");
    }

    #[test]
    fn unknown_codes_fall_back_to_tidied_text() {
        assert_eq!(rd_error_message(Some(999), "some_new_error"), "Some new error");
        assert_eq!(rd_error_message(None, "infringing_file"), "Infringing file");
        assert_eq!(rd_error_message(None, ""), "Real-Debrid returned an error");
    }

    #[test]
    fn api_errors_display_without_prefix() {
        let e = ProviderError::Api { message: "Torrent is too big".into(), code: Some(29) };
        assert_eq!(e.to_string(), "Torrent is too big");
    }
}
