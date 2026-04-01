use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct PmAccountInfo {
    pub status: String,
    pub customer_id: Option<u64>,
    pub premium_until: Option<u64>,
    #[serde(default)]
    pub limit_used: Option<f64>,
    #[serde(default)]
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
    pub id: String,
    pub name: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub progress: Option<f64>,
    pub folder_id: Option<String>,
    pub file_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmCreateResponse {
    pub status: String,
    pub id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmFolderList {
    pub status: String,
    #[serde(default)]
    pub content: Option<Vec<PmItem>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub size: Option<u64>,
    pub link: Option<String>,
    pub stream_link: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PmStatusResponse {
    pub status: String,
    pub message: Option<String>,
}
