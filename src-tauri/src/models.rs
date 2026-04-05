use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub status: String,
    pub created_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub quick_start_step: String,
    pub description: String,
    pub notes: String,
    pub status: String,
    pub priority: String,
    pub estimated_pomodoros: i64,
    pub completed_pomodoros: i64,
    pub due_date: Option<String>,
    pub is_today: bool,
    pub steps: Vec<String>,
    pub current_step_index: i64,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub project_id: Option<String>,
    pub todo_id: Option<String>,
    pub r#type: String,
    pub planned_duration_sec: i64,
    pub actual_duration_sec: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub result: String,
    pub interrupt_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub focus_minutes: i64,
    pub short_break_minutes: i64,
    pub long_break_minutes: i64,
    pub long_break_interval: i64,
    pub auto_start_breaks: bool,
    pub auto_start_focus: bool,
    pub notifications_enabled: bool,
    pub minimize_to_tray: bool,
    pub launch_on_startup: bool,
    pub sound_enabled: bool,
    pub ai_base_url: String,
    pub ai_api_key_configured: bool,
    pub ai_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalAppSettings {
    pub focus_minutes: i64,
    pub short_break_minutes: i64,
    pub long_break_minutes: i64,
    pub long_break_interval: i64,
    pub auto_start_breaks: bool,
    pub auto_start_focus: bool,
    pub notifications_enabled: bool,
    pub minimize_to_tray: bool,
    pub launch_on_startup: bool,
    pub sound_enabled: bool,
    pub ai_base_url: String,
    pub ai_api_key: String,
    pub ai_model_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAppSettingsInput {
    pub focus_minutes: i64,
    pub short_break_minutes: i64,
    pub long_break_minutes: i64,
    pub long_break_interval: i64,
    pub auto_start_breaks: bool,
    pub auto_start_focus: bool,
    pub notifications_enabled: bool,
    pub minimize_to_tray: bool,
    pub launch_on_startup: bool,
    pub sound_enabled: bool,
    pub ai_base_url: String,
    pub ai_api_key: String,
    pub ai_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub projects: Vec<Project>,
    pub todos: Vec<Todo>,
    pub sessions: Vec<FocusSession>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDraft {
    pub id: Option<String>,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoDraft {
    pub id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub quick_start_step: String,
    pub description: String,
    pub notes: String,
    pub status: String,
    pub priority: String,
    pub estimated_pomodoros: i64,
    pub due_date: Option<String>,
    pub is_today: bool,
    pub steps: Vec<String>,
    pub current_step_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionDraft {
    pub project_id: Option<String>,
    pub todo_id: Option<String>,
    pub r#type: String,
    pub planned_duration_sec: i64,
    pub actual_duration_sec: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub result: String,
    pub interrupt_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusFeedbackLog {
    pub id: String,
    pub project_id: String,
    pub todo_id: String,
    pub session_id: Option<String>,
    pub completed_text: String,
    pub issue_text: String,
    pub risk_text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusFeedbackDraft {
    pub project_id: String,
    pub todo_id: String,
    pub session_id: Option<String>,
    pub completed_text: String,
    pub issue_text: String,
    pub risk_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoAiSuggestion {
    pub todo_id: String,
    pub title: String,
    pub original_quick_start_step: String,
    pub updated_quick_start_step: String,
    pub original_description: String,
    pub updated_description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoActivationRelief {
    pub todo_id: String,
    pub title: String,
    pub quick_start_step: String,
    pub updated_description: String,
    pub fallback_step: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoActivationReliefRequest {
    pub todo_id: String,
    pub block_reason: String,
    pub mode: String,
    pub previous_relief: Option<TodoActivationRelief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusContinuationSuggestion {
    pub quick_start_step: String,
    pub next_steps: Vec<String>,
    pub fallback_step: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewSummary {
    pub summary: Vec<String>,
    pub issues: Vec<String>,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewRecord {
    pub id: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub timeframe: String,
    pub created_at: String,
    pub summary: Vec<String>,
    pub issues: Vec<String>,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewRecordDraft {
    pub scope: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub timeframe: String,
    pub summary: Vec<String>,
    pub issues: Vec<String>,
    pub suggestions: Vec<String>,
}
