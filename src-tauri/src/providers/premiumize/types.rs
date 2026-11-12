use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// Premiumize is loose with JSON types: ids arrive as strings or numbers, sizes as floats,
/// `premium_until` as `false` on free accounts. These helpers accept any of those shapes.
fn de_opt_u64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_f64().filter(|f| *f >= 0.0).map(|f| f as u64)),
        Value::String(s) => {
            let t = s.trim();
            t.parse::<u64>()
                .ok()
                .or_else(|| t.parse::<f64>().ok().filter(|f| *f >= 0.0).map(|f| f as u64))
        }
        _ => None,
    })
}

fn de_opt_f64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    })
}

fn de_opt_string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) => Some(s),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}

fn de_string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(de_opt_string(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmAccountInfo {
    pub status: String,
    #[serde(default, deserialize_with = "de_opt_string")]
    pub customer_id: Option<String>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub premium_until: Option<u64>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    pub limit_used: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub space_used: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmTransferList {
    pub status: String,
    #[serde(default)]
    pub transfers: Vec<PmTransfer>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmTransfer {
    #[serde(deserialize_with = "de_string")]
    pub id: String,
    pub name: Option<String>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    pub progress: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_string")]
    pub folder_id: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string")]
    pub file_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmCreateResponse {
    pub status: String,
    #[serde(default, deserialize_with = "de_opt_string")]
    pub id: Option<String>,
    pub name: Option<String>,
    /// Present when status is "error".
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmFolderList {
    pub status: String,
    #[serde(default)]
    pub content: Option<Vec<PmItem>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmItem {
    #[serde(deserialize_with = "de_string")]
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub size: Option<u64>,
    pub link: Option<String>,
    pub stream_link: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmStatusResponse {
    pub status: String,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmCacheCheckResponse {
    pub status: String,
    #[serde(default)]
    pub response: Vec<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_info_with_string_id_and_float_space_decodes() {
        // Shape Premiumize actually returns for a valid key (issue #70).
        let body = r#"{"status":"success","customer_id":"123456789","premium_until":1767225600,
                       "limit_used":0.0123,"space_used":52428800.5}"#;
        let a: PmAccountInfo = serde_json::from_str(body).unwrap();
        assert_eq!(a.status, "success");
        assert_eq!(a.customer_id.as_deref(), Some("123456789"));
        assert_eq!(a.premium_until, Some(1767225600));
        assert_eq!(a.limit_used, Some(0.0123));
        assert_eq!(a.space_used, Some(52428800));
    }

    #[test]
    fn account_info_numeric_id_and_scientific_space_decode() {
        let body = r#"{"status":"success","customer_id":42,"premium_until":"1767225600",
                       "limit_used":"0.5","space_used":1.2e10}"#;
        let a: PmAccountInfo = serde_json::from_str(body).unwrap();
        assert_eq!(a.customer_id.as_deref(), Some("42"));
        assert_eq!(a.premium_until, Some(1767225600));
        assert_eq!(a.limit_used, Some(0.5));
        assert_eq!(a.space_used, Some(12_000_000_000));
    }

    #[test]
    fn account_info_free_account_with_false_premium_until_decodes() {
        let body = r#"{"status":"success","customer_id":"7","premium_until":false,
                       "limit_used":null,"space_used":0}"#;
        let a: PmAccountInfo = serde_json::from_str(body).unwrap();
        assert_eq!(a.premium_until, None);
        assert_eq!(a.limit_used, None);
        assert_eq!(a.space_used, Some(0));
    }

    #[test]
    fn account_info_error_body_decodes() {
        let a: PmAccountInfo =
            serde_json::from_str(r#"{"status":"error","message":"Not logged in."}"#).unwrap();
        assert_eq!(a.status, "error");
        assert!(a.customer_id.is_none());
    }

    #[test]
    fn transfer_list_with_numeric_ids_and_null_progress_decodes() {
        let body = r#"{"status":"success","transfers":[
            {"id":"abc","name":"t","status":"finished","progress":null,"folder_id":"f1","file_id":null,"message":null},
            {"id":99,"name":"u","status":"running","progress":"0.4","folder_id":12,"file_id":null}]}"#;
        let l: PmTransferList = serde_json::from_str(body).unwrap();
        assert_eq!(l.transfers.len(), 2);
        assert_eq!(l.transfers[0].progress, None);
        assert_eq!(l.transfers[0].folder_id.as_deref(), Some("f1"));
        assert_eq!(l.transfers[1].id, "99");
        assert_eq!(l.transfers[1].progress, Some(0.4));
        assert_eq!(l.transfers[1].folder_id.as_deref(), Some("12"));
    }

    #[test]
    fn folder_item_with_float_or_string_size_decodes() {
        let body = r#"{"status":"success","content":[
            {"id":"a","name":"a.mkv","type":"file","size":1048576.0,"link":"https://x/a"},
            {"id":5,"name":"b.mkv","type":"file","size":"2048"},
            {"id":"d","name":"dir","type":"folder"}]}"#;
        let f: PmFolderList = serde_json::from_str(body).unwrap();
        let c = f.content.unwrap();
        assert_eq!(c[0].size, Some(1_048_576));
        assert_eq!(c[1].id, "5");
        assert_eq!(c[1].size, Some(2048));
        assert_eq!(c[2].size, None);
    }
}
