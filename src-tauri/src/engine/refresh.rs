use super::types::LinkSource;

#[derive(Debug, Clone)]
pub struct RefreshedLink {
    pub url: String,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum RefreshError {
    #[error("Switch back to {0} to resume")]
    ProviderMismatch(String),
    #[error("this link can't be refreshed")]
    NotRefreshable,
    #[error("{0}")]
    Failed(String),
}

#[async_trait::async_trait]
pub trait LinkRefresher: Send + Sync + 'static {
    async fn refresh(&self, source: &LinkSource) -> Result<RefreshedLink, RefreshError>;
}
