use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorCategory {
    ConfigMissing,
    ValidationFailed,
    GitFailed,
    GitlabFailed,
    NotFound,
    Conflict,
    Internal,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub category: CommandErrorCategory,
    pub message_zh: String,
    pub detail: Option<String>,
}

impl CommandError {
    pub fn new(
        category: CommandErrorCategory,
        message_zh: impl Into<String>,
        detail: Option<String>,
    ) -> Self {
        Self {
            category,
            message_zh: message_zh.into(),
            detail,
        }
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message_zh)
    }
}

impl std::error::Error for CommandError {}
