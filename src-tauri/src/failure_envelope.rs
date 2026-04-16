#[derive(Debug, Clone)]
pub(crate) struct FailureEnvelope {
    pub(crate) error_code: String,
    pub(crate) title_zh: String,
    pub(crate) detail_zh: String,
    pub(crate) suggestion_zh: String,
    pub(crate) evidence: String,
}

pub(crate) fn build_failure_envelope(
    error_code: &str,
    title_zh: &str,
    detail_zh: String,
    suggestion_zh: &str,
    evidence: String,
) -> FailureEnvelope {
    FailureEnvelope {
        error_code: error_code.to_string(),
        title_zh: title_zh.to_string(),
        detail_zh,
        suggestion_zh: suggestion_zh.to_string(),
        evidence,
    }
}
