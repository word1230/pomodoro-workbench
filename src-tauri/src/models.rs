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
    pub description: String,
    pub notes: String,
    pub status: String,
    pub priority: String,
    pub estimated_pomodoros: i64,
    pub completed_pomodoros: i64,
    pub due_date: Option<String>,
    pub is_today: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub project_id: String,
    pub todo_id: String,
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
    pub description: String,
    pub notes: String,
    pub status: String,
    pub priority: String,
    pub estimated_pomodoros: i64,
    pub due_date: Option<String>,
    pub is_today: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionDraft {
    pub project_id: String,
    pub todo_id: String,
    pub r#type: String,
    pub planned_duration_sec: i64,
    pub actual_duration_sec: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub result: String,
    pub interrupt_reason: Option<String>,
}
