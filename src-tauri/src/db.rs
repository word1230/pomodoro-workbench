use std::{collections::HashSet, fs, path::PathBuf};

use chrono::{Duration, Local, Utc};
use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde_json::{from_str, to_string as to_json_string};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::{
    AiReviewRecord, AiReviewRecordDraft, AppSettings, AppSnapshot, FocusSession, FocusSessionDraft,
    FocusFeedbackDraft, FocusFeedbackLog, InternalAppSettings, Project, ProjectDraft,
    SaveAppSettingsInput, Todo, TodoDraft,
};

type AppResult<T> = Result<T, String>;

const DATABASE_FILE: &str = "pomodoro-workbench.db";

pub fn init_database(app: &AppHandle) -> AppResult<()> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    seed_if_empty(&connection)?;
    Ok(())
}

pub fn load_snapshot(app: &AppHandle) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    load_snapshot_from_connection(&connection)
}

pub fn save_project(app: &AppHandle, project: ProjectDraft) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    let now = Utc::now().to_rfc3339();
    create_schema(&connection)?;
    ensure_settings(&connection)?;

    if let Some(id) = project.id {
        connection
            .execute(
                "UPDATE projects
                 SET name = ?2, color = ?3, icon = ?4, status = ?5, archived_at = ?6
                 WHERE id = ?1",
                params![
                    id,
                    project.name,
                    project.color,
                    project.icon,
                    project.status,
                    archived_at_for_status(&project.status, &now)
                ],
            )
            .map_err(to_string)?;
    } else {
        connection
            .execute(
                "INSERT INTO projects (id, name, color, icon, status, created_at, archived_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    Uuid::new_v4().to_string(),
                    project.name,
                    project.color,
                    project.icon,
                    project.status,
                    now,
                    archived_at_for_status(&project.status, &now)
                ],
            )
            .map_err(to_string)?;
    }

    load_snapshot_from_connection(&connection)
}

pub fn archive_project(app: &AppHandle, project_id: &str, archived: bool) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    let status = if archived { "archived" } else { "active" };
    let archived_at = if archived {
        Some(Utc::now().to_rfc3339())
    } else {
        None
    };

    connection
        .execute(
            "UPDATE projects SET status = ?2, archived_at = ?3 WHERE id = ?1",
            params![project_id, status, archived_at],
        )
        .map_err(to_string)?;

    load_snapshot_from_connection(&connection)
}

pub fn delete_project(app: &AppHandle, project_id: &str) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;

    connection
        .execute("DELETE FROM projects WHERE id = ?1", params![project_id])
        .map_err(to_string)?;

    load_snapshot_from_connection(&connection)
}

pub fn save_todo(app: &AppHandle, todo: TodoDraft) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    save_todo_with_connection(&connection, todo)?;
    load_snapshot_from_connection(&connection)
}

pub fn delete_todo(app: &AppHandle, todo_id: &str) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    connection
        .execute("DELETE FROM todos WHERE id = ?1", params![todo_id])
        .map_err(to_string)?;
    load_snapshot_from_connection(&connection)
}

pub fn save_settings(app: &AppHandle, settings: SaveAppSettingsInput) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    save_settings_with_connection(&connection, settings)
}

pub fn clear_all_data(app: &AppHandle) -> AppResult<AppSnapshot> {
    let mut connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    clear_all_data_with_connection(&mut connection)?;
    load_snapshot_from_connection(&connection)
}

pub fn record_focus_session(app: &AppHandle, session: FocusSessionDraft) -> AppResult<AppSnapshot> {
    let mut connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    record_focus_session_with_connection(&mut connection, session)?;
    load_snapshot_from_connection(&connection)
}

pub fn should_minimize_to_tray(app: &AppHandle) -> AppResult<bool> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    Ok(load_settings_from_connection(&connection)?.minimize_to_tray)
}

pub fn load_settings(app: &AppHandle) -> AppResult<InternalAppSettings> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    load_settings_from_connection(&connection)
}

pub fn load_ai_reviews(app: &AppHandle) -> AppResult<Vec<AiReviewRecord>> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    load_ai_reviews_from_connection(&connection)
}

pub fn save_ai_review(app: &AppHandle, review: AiReviewRecordDraft) -> AppResult<AiReviewRecord> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    let record = AiReviewRecord {
        id: Uuid::new_v4().to_string(),
        scope: review.scope,
        project_id: review.project_id,
        project_name: review.project_name,
        timeframe: review.timeframe,
        created_at: Utc::now().to_rfc3339(),
        summary: review.summary,
        issues: review.issues,
        suggestions: review.suggestions,
    };

    connection
        .execute(
            "INSERT INTO ai_reviews (
                id, scope, project_id, project_name, timeframe, created_at,
                summary_json, issues_json, suggestions_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                record.id,
                record.scope,
                record.project_id,
                record.project_name,
                record.timeframe,
                record.created_at,
                to_json_string(&record.summary).map_err(to_string)?,
                to_json_string(&record.issues).map_err(to_string)?,
                to_json_string(&record.suggestions).map_err(to_string)?,
            ],
        )
        .map_err(to_string)?;

    Ok(record)
}

pub fn save_focus_feedback_log(
    app: &AppHandle,
    feedback: FocusFeedbackDraft,
) -> AppResult<FocusFeedbackLog> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;

    save_focus_feedback_log_with_connection(&connection, feedback)
}

fn save_focus_feedback_log_with_connection(
    connection: &Connection,
    feedback: FocusFeedbackDraft,
) -> AppResult<FocusFeedbackLog> {
    let record = prepare_focus_feedback_log_with_connection(connection, feedback)?;
    if let Some(existing) = find_matching_focus_feedback_log(connection, &record)? {
        return Ok(existing);
    }
    insert_focus_feedback_log(connection, &record)?;

    Ok(record)
}

pub fn load_recent_focus_feedback_logs(
    app: &AppHandle,
    project_id: &str,
    limit: i64,
) -> AppResult<Vec<FocusFeedbackLog>> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    let limit = limit.clamp(1, 50);

    let mut statement = connection
        .prepare(
            "SELECT
                id, project_id, todo_id, session_id, completed_text, issue_text, risk_text, created_at
             FROM focus_feedback_logs
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )
        .map_err(to_string)?;

    let rows = statement
        .query_map(params![project_id, limit], |row| {
            Ok(FocusFeedbackLog {
                id: row.get(0)?,
                project_id: row.get(1)?,
                todo_id: row.get(2)?,
                session_id: row.get(3)?,
                completed_text: row.get(4)?,
                issue_text: row.get(5)?,
                risk_text: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(to_string)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn save_todo_with_connection(connection: &Connection, todo: TodoDraft) -> AppResult<()> {
    let project_exists = connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1",
            params![&todo.project_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(to_string)?
        .is_some();

    if !project_exists {
        return Err("Project not found.".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let steps_json = to_json_string(&todo.steps).map_err(to_string)?;
    let estimated_pomodoros = normalize_pomodoro_count(todo.estimated_pomodoros);

    if let Some(id) = todo.id {
        let existing = connection
            .query_row(
                "SELECT completed_pomodoros, completed_at FROM todos WHERE id = ?1",
                params![&id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(to_string)?;
        let (completed_pomodoros, existing_completed_at) =
            existing.ok_or_else(|| "Todo not found.".to_string())?;
        let completed_at = if todo.status == "done" {
            existing_completed_at.or_else(|| Some(now.clone()))
        } else {
            None
        };

        connection
            .execute(
                "UPDATE todos
                 SET project_id = ?2, title = ?3, quick_start_step = ?4, description = ?5, notes = ?6,
                     status = ?7, priority = ?8, estimated_pomodoros = ?9, completed_pomodoros = ?10,
                     due_date = ?11, is_today = ?12, steps_json = ?13, current_step_index = ?14,
                     completed_at = ?15
                 WHERE id = ?1",
                params![
                    id,
                    todo.project_id,
                    todo.title,
                    todo.quick_start_step,
                    todo.description,
                    todo.notes,
                    todo.status,
                    todo.priority,
                    estimated_pomodoros,
                    completed_pomodoros,
                    todo.due_date,
                    bool_to_int(todo.is_today),
                    steps_json,
                    todo.current_step_index,
                    completed_at,
                ],
            )
            .map_err(to_string)?;
    } else {
        let completed_at = if todo.status == "done" {
            Some(now.clone())
        } else {
            None
        };

        connection
            .execute(
                "INSERT INTO todos (
                    id, project_id, title, quick_start_step, description, notes, status, priority,
                    estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json,
                    current_step_index, created_at, completed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    Uuid::new_v4().to_string(),
                    todo.project_id,
                    todo.title,
                    todo.quick_start_step,
                    todo.description,
                    todo.notes,
                    todo.status,
                    todo.priority,
                    estimated_pomodoros,
                    todo.due_date,
                    bool_to_int(todo.is_today),
                    steps_json,
                    todo.current_step_index,
                    now,
                    completed_at,
                ],
            )
            .map_err(to_string)?;
    }

    Ok(())
}

fn record_focus_session_with_connection(
    connection: &mut Connection,
    session: FocusSessionDraft,
) -> AppResult<()> {
    let transaction = connection.transaction().map_err(to_string)?;
    let focus_ids = if session.r#type == "focus" {
        let project_id = session
            .project_id
            .as_deref()
            .ok_or_else(|| "Focus sessions require project_id.".to_string())?;
        let todo_id = session
            .todo_id
            .as_deref()
            .ok_or_else(|| "Focus sessions require todo_id.".to_string())?;
        let todo_project_id = transaction
            .query_row(
                "SELECT project_id FROM todos WHERE id = ?1",
                params![todo_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_string)?;

        match todo_project_id {
            None => return Err("Todo not found.".to_string()),
            Some(existing_project_id) if existing_project_id != project_id => {
                return Err("Todo does not belong to project.".to_string())
            }
            Some(_) => {}
        }

        Some((project_id.to_string(), todo_id.to_string()))
    } else {
        None
    };

    transaction
        .execute(
            "INSERT INTO focus_sessions (
                id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
                started_at, ended_at, result, interrupt_reason
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                Uuid::new_v4().to_string(),
                session.project_id.as_deref(),
                session.todo_id.as_deref(),
                &session.r#type,
                session.planned_duration_sec,
                session.actual_duration_sec,
                &session.started_at,
                &session.ended_at,
                &session.result,
                &session.interrupt_reason,
            ],
        )
        .map_err(to_string)?;

    if session.r#type == "focus" && session.result == "completed" {
        let (project_id, todo_id) = focus_ids
            .as_ref()
            .expect("focus sessions should have validated ids");
        let completed_at = Utc::now().to_rfc3339();
        transaction
            .execute(
                "UPDATE todos
                 SET completed_pomodoros = completed_pomodoros + 1,
                     status = CASE
                         WHEN completed_pomodoros + 1 >= estimated_pomodoros THEN 'done'
                         ELSE 'in_progress'
                     END,
                     completed_at = CASE
                         WHEN completed_pomodoros + 1 >= estimated_pomodoros THEN COALESCE(completed_at, ?2)
                         ELSE NULL
                     END
                 WHERE id = ?1 AND project_id = ?3",
                params![todo_id, completed_at, project_id],
            )
            .map_err(to_string)?;
    } else if session.r#type == "focus" {
        let (project_id, todo_id) = focus_ids
            .as_ref()
            .expect("focus sessions should have validated ids");
        transaction
            .execute(
                "UPDATE todos
                 SET status = CASE WHEN status = 'done' THEN status ELSE 'in_progress' END,
                     completed_at = CASE WHEN status = 'done' THEN completed_at ELSE NULL END
                 WHERE id = ?1 AND project_id = ?2",
                params![todo_id, project_id],
            )
            .map_err(to_string)?;
    }

    transaction.commit().map_err(to_string)?;
    Ok(())
}

fn prepare_focus_feedback_log_with_connection(
    connection: &Connection,
    feedback: FocusFeedbackDraft,
) -> AppResult<FocusFeedbackLog> {
    let project_exists = connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1",
            params![&feedback.project_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(to_string)?
        .is_some();

    if !project_exists {
        return Err("Project not found.".to_string());
    }

    let todo_project_id = connection
        .query_row(
            "SELECT project_id FROM todos WHERE id = ?1",
            params![&feedback.todo_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(to_string)?;

    match todo_project_id {
        None => return Err("Todo not found.".to_string()),
        Some(project_id) if project_id != feedback.project_id => {
            return Err("Todo does not belong to project.".to_string())
        }
        Some(_) => {}
    }

    if let Some(session_id) = &feedback.session_id {
        let session = connection
            .query_row(
                "SELECT project_id, todo_id FROM focus_sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(to_string)?;
        let (session_project_id, session_todo_id) =
            session.ok_or_else(|| "Session not found.".to_string())?;

        if session_project_id != feedback.project_id || session_todo_id != feedback.todo_id {
            return Err("Session does not belong to todo.".to_string());
        }
    }

    Ok(FocusFeedbackLog {
        id: Uuid::new_v4().to_string(),
        project_id: feedback.project_id,
        todo_id: feedback.todo_id,
        session_id: feedback.session_id,
        completed_text: feedback.completed_text,
        issue_text: feedback.issue_text,
        risk_text: feedback.risk_text,
        created_at: Utc::now().to_rfc3339(),
    })
}

fn insert_focus_feedback_log(connection: &Connection, record: &FocusFeedbackLog) -> AppResult<()> {
    connection
        .execute(
            "INSERT INTO focus_feedback_logs (
                id, project_id, todo_id, session_id, completed_text, issue_text, risk_text, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &record.id,
                &record.project_id,
                &record.todo_id,
                &record.session_id,
                &record.completed_text,
                &record.issue_text,
                &record.risk_text,
                &record.created_at,
            ],
        )
        .map_err(to_string)?;

    Ok(())
}

fn find_matching_focus_feedback_log(
    connection: &Connection,
    record: &FocusFeedbackLog,
) -> AppResult<Option<FocusFeedbackLog>> {
    connection
        .query_row(
            "SELECT
                id, project_id, todo_id, session_id, completed_text, issue_text, risk_text, created_at
             FROM focus_feedback_logs
             WHERE project_id = ?1
               AND todo_id = ?2
               AND ((session_id IS NULL AND ?3 IS NULL) OR session_id = ?3)
               AND completed_text = ?4
               AND issue_text = ?5
               AND risk_text = ?6
             ORDER BY created_at DESC
             LIMIT 1",
            params![
                &record.project_id,
                &record.todo_id,
                &record.session_id,
                &record.completed_text,
                &record.issue_text,
                &record.risk_text,
            ],
            |row| {
                Ok(FocusFeedbackLog {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    todo_id: row.get(2)?,
                    session_id: row.get(3)?,
                    completed_text: row.get(4)?,
                    issue_text: row.get(5)?,
                    risk_text: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(to_string)
}

fn default_internal_settings() -> InternalAppSettings {
    InternalAppSettings {
        focus_minutes: 25,
        short_break_minutes: 5,
        long_break_minutes: 15,
        long_break_interval: 4,
        auto_start_breaks: true,
        auto_start_focus: false,
        notifications_enabled: true,
        minimize_to_tray: true,
        launch_on_startup: false,
        sound_enabled: true,
        ai_base_url: String::new(),
        ai_api_key: String::new(),
        ai_model_id: String::new(),
    }
}

fn load_snapshot_from_connection(connection: &Connection) -> AppResult<AppSnapshot> {
    Ok(AppSnapshot {
        settings: redact_settings(load_settings_from_connection(connection)?),
        projects: load_projects(connection)?,
        todos: load_todos(connection)?,
        sessions: load_sessions(connection)?,
    })
}

fn redact_settings(settings: InternalAppSettings) -> AppSettings {
    AppSettings {
        focus_minutes: settings.focus_minutes,
        short_break_minutes: settings.short_break_minutes,
        long_break_minutes: settings.long_break_minutes,
        long_break_interval: settings.long_break_interval,
        auto_start_breaks: settings.auto_start_breaks,
        auto_start_focus: settings.auto_start_focus,
        notifications_enabled: settings.notifications_enabled,
        minimize_to_tray: settings.minimize_to_tray,
        launch_on_startup: settings.launch_on_startup,
        sound_enabled: settings.sound_enabled,
        ai_base_url: settings.ai_base_url,
        ai_api_key_configured: !settings.ai_api_key.trim().is_empty(),
        ai_model_id: settings.ai_model_id,
    }
}

fn clear_all_data_with_connection(connection: &mut Connection) -> AppResult<()> {
    let transaction = connection.transaction().map_err(to_string)?;
    transaction
        .execute("DELETE FROM focus_feedback_logs", [])
        .map_err(to_string)?;
    transaction
        .execute("DELETE FROM ai_reviews", [])
        .map_err(to_string)?;
    transaction
        .execute("DELETE FROM focus_sessions", [])
        .map_err(to_string)?;
    transaction
        .execute("DELETE FROM todos", [])
        .map_err(to_string)?;
    transaction
        .execute("DELETE FROM projects", [])
        .map_err(to_string)?;

    reset_settings_to_defaults(&transaction)?;
    transaction.commit().map_err(to_string)?;
    Ok(())
}

fn reset_settings_to_defaults(connection: &Connection) -> AppResult<()> {
    let defaults = default_internal_settings();
    connection
        .execute(
            "UPDATE settings
             SET focus_minutes = ?1, short_break_minutes = ?2, long_break_minutes = ?3,
                 long_break_interval = ?4, auto_start_breaks = ?5, auto_start_focus = ?6,
                 notifications_enabled = ?7, minimize_to_tray = ?8, launch_on_startup = ?9, sound_enabled = ?10,
                 ai_base_url = ?11, ai_api_key = ?12, ai_model_id = ?13
             WHERE id = 1",
            params![
                defaults.focus_minutes,
                defaults.short_break_minutes,
                defaults.long_break_minutes,
                defaults.long_break_interval,
                bool_to_int(defaults.auto_start_breaks),
                bool_to_int(defaults.auto_start_focus),
                bool_to_int(defaults.notifications_enabled),
                bool_to_int(defaults.minimize_to_tray),
                bool_to_int(defaults.launch_on_startup),
                bool_to_int(defaults.sound_enabled),
                defaults.ai_base_url,
                defaults.ai_api_key,
                defaults.ai_model_id,
            ],
        )
        .map_err(to_string)?;
    Ok(())
}

fn save_settings_with_connection(
    connection: &Connection,
    settings: SaveAppSettingsInput,
) -> AppResult<AppSnapshot> {
    let existing_ai_api_key: String = connection
        .query_row("SELECT ai_api_key FROM settings WHERE id = 1", [], |row| row.get(0))
        .map_err(to_string)?;
    let next_ai_api_key = if settings.ai_api_key.trim().is_empty() {
        existing_ai_api_key
    } else {
        settings.ai_api_key
    };

    connection
        .execute(
            "UPDATE settings
             SET focus_minutes = ?1, short_break_minutes = ?2, long_break_minutes = ?3,
                 long_break_interval = ?4, auto_start_breaks = ?5, auto_start_focus = ?6,
                 notifications_enabled = ?7, minimize_to_tray = ?8, launch_on_startup = ?9, sound_enabled = ?10,
                 ai_base_url = ?11, ai_api_key = ?12, ai_model_id = ?13
             WHERE id = 1",
            params![
                settings.focus_minutes,
                settings.short_break_minutes,
                settings.long_break_minutes,
                settings.long_break_interval,
                bool_to_int(settings.auto_start_breaks),
                bool_to_int(settings.auto_start_focus),
                bool_to_int(settings.notifications_enabled),
                bool_to_int(settings.minimize_to_tray),
                bool_to_int(settings.launch_on_startup),
                bool_to_int(settings.sound_enabled),
                settings.ai_base_url,
                next_ai_api_key,
                settings.ai_model_id
            ],
        )
        .map_err(to_string)?;

    load_snapshot_from_connection(connection)
}

fn load_settings_from_connection(connection: &Connection) -> AppResult<InternalAppSettings> {
    connection
        .query_row(
            "SELECT
                focus_minutes, short_break_minutes, long_break_minutes, long_break_interval,
                auto_start_breaks, auto_start_focus, notifications_enabled, minimize_to_tray,
                launch_on_startup, sound_enabled, ai_base_url, ai_api_key, ai_model_id
             FROM settings
             WHERE id = 1",
            [],
            |row| {
                Ok(InternalAppSettings {
                    focus_minutes: row.get(0)?,
                    short_break_minutes: row.get(1)?,
                    long_break_minutes: row.get(2)?,
                    long_break_interval: row.get(3)?,
                    auto_start_breaks: int_to_bool(row.get::<_, i64>(4)?),
                    auto_start_focus: int_to_bool(row.get::<_, i64>(5)?),
                    notifications_enabled: int_to_bool(row.get::<_, i64>(6)?),
                    minimize_to_tray: int_to_bool(row.get::<_, i64>(7)?),
                    launch_on_startup: int_to_bool(row.get::<_, i64>(8)?),
                    sound_enabled: int_to_bool(row.get::<_, i64>(9)?),
                    ai_base_url: row.get(10)?,
                    ai_api_key: row.get(11)?,
                    ai_model_id: row.get(12)?,
                })
            },
        )
        .map_err(to_string)
}

fn load_projects(connection: &Connection) -> AppResult<Vec<Project>> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, color, icon, status, created_at, archived_at
             FROM projects
             ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                created_at DESC",
        )
        .map_err(to_string)?;

    let rows = statement
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                icon: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                archived_at: row.get(6)?,
            })
        })
        .map_err(to_string)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn load_todos(connection: &Connection) -> AppResult<Vec<Todo>> {
    let mut statement = connection
        .prepare(
            "SELECT
                id, project_id, title, quick_start_step, description, notes, status, priority,
                estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json, current_step_index,
                created_at, completed_at
             FROM todos
             ORDER BY is_today DESC, created_at DESC",
        )
        .map_err(to_string)?;

    let rows = statement
        .query_map([], |row| {
            let steps_json = row.get::<_, String>(12)?;
            let steps = from_str(&steps_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(12, Type::Text, Box::new(error))
            })?;

            Ok(Todo {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                quick_start_step: row.get(3)?,
                description: row.get(4)?,
                notes: row.get(5)?,
                status: row.get(6)?,
                priority: row.get(7)?,
                estimated_pomodoros: row.get(8)?,
                completed_pomodoros: row.get(9)?,
                due_date: row.get(10)?,
                is_today: int_to_bool(row.get::<_, i64>(11)?),
                steps,
                current_step_index: row.get(13)?,
                created_at: row.get(14)?,
                completed_at: row.get(15)?,
            })
        })
        .map_err(to_string)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn load_sessions(connection: &Connection) -> AppResult<Vec<FocusSession>> {
    let mut statement = connection
        .prepare(
            "SELECT
                id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
                started_at, ended_at, result, interrupt_reason
             FROM focus_sessions
             ORDER BY started_at DESC",
        )
        .map_err(to_string)?;

    let rows = statement
        .query_map([], |row| {
            Ok(FocusSession {
                id: row.get(0)?,
                project_id: row.get(1)?,
                todo_id: row.get(2)?,
                r#type: row.get(3)?,
                planned_duration_sec: row.get(4)?,
                actual_duration_sec: row.get(5)?,
                started_at: row.get(6)?,
                ended_at: row.get(7)?,
                result: row.get(8)?,
                interrupt_reason: row.get(9)?,
            })
        })
        .map_err(to_string)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn load_ai_reviews_from_connection(connection: &Connection) -> AppResult<Vec<AiReviewRecord>> {
    let mut statement = connection
        .prepare(
            "SELECT
                id, scope, project_id, project_name, timeframe, created_at,
                summary_json, issues_json, suggestions_json
             FROM ai_reviews
             ORDER BY created_at DESC",
        )
        .map_err(to_string)?;

    let rows = statement
        .query_map([], |row| {
            let summary_json = row.get::<_, String>(6)?;
            let issues_json = row.get::<_, String>(7)?;
            let suggestions_json = row.get::<_, String>(8)?;
            let summary = from_str(&summary_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(6, Type::Text, Box::new(error))
            })?;
            let issues = from_str(&issues_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(7, Type::Text, Box::new(error))
            })?;
            let suggestions = from_str(&suggestions_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(8, Type::Text, Box::new(error))
            })?;

            Ok(AiReviewRecord {
                id: row.get(0)?,
                scope: row.get(1)?,
                project_id: row.get(2)?,
                project_name: row.get(3)?,
                timeframe: row.get(4)?,
                created_at: row.get(5)?,
                summary,
                issues,
                suggestions,
            })
        })
        .map_err(to_string)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn connection(app: &AppHandle) -> AppResult<Connection> {
    let path = database_path(app)?;
    let connection = Connection::open(path).map_err(to_string)?;
    connection.execute("PRAGMA foreign_keys = ON", []).map_err(to_string)?;
    Ok(connection)
}

fn database_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app.path().app_data_dir().map_err(to_string)?;
    fs::create_dir_all(&directory).map_err(to_string)?;
    Ok(directory.join(DATABASE_FILE))
}

fn create_schema(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                focus_minutes INTEGER NOT NULL,
                short_break_minutes INTEGER NOT NULL,
                long_break_minutes INTEGER NOT NULL,
                long_break_interval INTEGER NOT NULL,
                auto_start_breaks INTEGER NOT NULL,
                auto_start_focus INTEGER NOT NULL,
                notifications_enabled INTEGER NOT NULL,
                minimize_to_tray INTEGER NOT NULL,
                launch_on_startup INTEGER NOT NULL,
                sound_enabled INTEGER NOT NULL,
                ai_base_url TEXT NOT NULL DEFAULT '',
                ai_api_key TEXT NOT NULL DEFAULT '',
                ai_model_id TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                icon TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                archived_at TEXT
            );

            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                quick_start_step TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                priority TEXT NOT NULL,
                estimated_pomodoros INTEGER NOT NULL,
                completed_pomodoros INTEGER NOT NULL DEFAULT 0,
                due_date TEXT,
                is_today INTEGER NOT NULL DEFAULT 0,
                steps_json TEXT NOT NULL DEFAULT '[]',
                current_step_index INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                UNIQUE (id, project_id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS focus_sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                todo_id TEXT,
                type TEXT NOT NULL,
                planned_duration_sec INTEGER NOT NULL,
                actual_duration_sec INTEGER NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                result TEXT NOT NULL,
                interrupt_reason TEXT,
                FOREIGN KEY (todo_id, project_id) REFERENCES todos(id, project_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ai_reviews (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                project_id TEXT,
                project_name TEXT,
                timeframe TEXT NOT NULL,
                created_at TEXT NOT NULL,
                summary_json TEXT NOT NULL,
                issues_json TEXT NOT NULL,
                suggestions_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS focus_feedback_logs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                todo_id TEXT NOT NULL,
                session_id TEXT,
                completed_text TEXT NOT NULL,
                issue_text TEXT NOT NULL DEFAULT '',
                risk_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (todo_id, project_id) REFERENCES todos(id, project_id) ON DELETE CASCADE,
                FOREIGN KEY (session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE
            );
            ",
        )
        .map_err(to_string)?;
    migrate_settings_schema(connection)?;
    migrate_todos_schema(connection)?;
    migrate_relational_schema(connection)?;
    Ok(())
}

fn ensure_settings(connection: &Connection) -> AppResult<()> {
    let defaults = default_internal_settings();
    connection
        .execute(
            "INSERT OR IGNORE INTO settings (
                id, focus_minutes, short_break_minutes, long_break_minutes, long_break_interval,
                auto_start_breaks, auto_start_focus, notifications_enabled, minimize_to_tray,
                launch_on_startup, sound_enabled, ai_base_url, ai_api_key, ai_model_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                1,
                defaults.focus_minutes,
                defaults.short_break_minutes,
                defaults.long_break_minutes,
                defaults.long_break_interval,
                bool_to_int(defaults.auto_start_breaks),
                bool_to_int(defaults.auto_start_focus),
                bool_to_int(defaults.notifications_enabled),
                bool_to_int(defaults.minimize_to_tray),
                bool_to_int(defaults.launch_on_startup),
                bool_to_int(defaults.sound_enabled),
                defaults.ai_base_url,
                defaults.ai_api_key,
                defaults.ai_model_id,
            ],
        )
        .map_err(to_string)?;
    Ok(())
}

fn migrate_settings_schema(connection: &Connection) -> AppResult<()> {
    let mut statement = connection
        .prepare("PRAGMA table_info(settings)")
        .map_err(to_string)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_string)?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(to_string)?;

    add_settings_column_if_missing(connection, &columns, "ai_base_url", "TEXT NOT NULL DEFAULT ''")?;
    add_settings_column_if_missing(connection, &columns, "ai_api_key", "TEXT NOT NULL DEFAULT ''")?;
    add_settings_column_if_missing(connection, &columns, "ai_model_id", "TEXT NOT NULL DEFAULT ''")?;

    Ok(())
}

fn migrate_todos_schema(connection: &Connection) -> AppResult<()> {
    let mut statement = connection
        .prepare("PRAGMA table_info(todos)")
        .map_err(to_string)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_string)?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(to_string)?;

    add_column_if_missing(connection, &columns, "todos", "quick_start_step", "TEXT NOT NULL DEFAULT ''")?;
    add_column_if_missing(connection, &columns, "todos", "steps_json", "TEXT NOT NULL DEFAULT '[]'")?;
    add_column_if_missing(connection, &columns, "todos", "current_step_index", "INTEGER NOT NULL DEFAULT 0")?;

    Ok(())
}

fn migrate_relational_schema(connection: &Connection) -> AppResult<()> {
    rebuild_table_if_foreign_keys_missing(
        connection,
        "todos",
        "project_id",
        "projects",
        "CREATE TABLE todos_new (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            quick_start_step TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            priority TEXT NOT NULL,
            estimated_pomodoros INTEGER NOT NULL,
            completed_pomodoros INTEGER NOT NULL DEFAULT 0,
            due_date TEXT,
            is_today INTEGER NOT NULL DEFAULT 0,
            steps_json TEXT NOT NULL DEFAULT '[]',
            current_step_index INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE (id, project_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )",
        "INSERT INTO todos_new (
            id, project_id, title, quick_start_step, description, notes, status, priority,
            estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json,
            current_step_index, created_at, completed_at
        )
        SELECT
            t.id, t.project_id, t.title, t.quick_start_step, t.description, t.notes, t.status, t.priority,
            t.estimated_pomodoros, t.completed_pomodoros, t.due_date, t.is_today, t.steps_json,
            t.current_step_index, t.created_at, t.completed_at
        FROM todos t
        WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id)",
    )?;

    rebuild_focus_sessions_table_if_needed(connection)?;

    rebuild_table_if_foreign_keys_missing(
        connection,
        "focus_feedback_logs",
        "todo_id",
        "todos",
        "CREATE TABLE focus_feedback_logs_new (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            todo_id TEXT NOT NULL,
            session_id TEXT,
            completed_text TEXT NOT NULL,
            issue_text TEXT NOT NULL DEFAULT '',
            risk_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (todo_id, project_id) REFERENCES todos(id, project_id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE
        )",
        "INSERT INTO focus_feedback_logs_new (
            id, project_id, todo_id, session_id, completed_text, issue_text, risk_text, created_at
        )
        SELECT
            l.id, l.project_id, l.todo_id, l.session_id, l.completed_text, l.issue_text, l.risk_text, l.created_at
        FROM focus_feedback_logs l
        WHERE EXISTS (
            SELECT 1 FROM todos t WHERE t.id = l.todo_id AND t.project_id = l.project_id
        )
          AND (
            l.session_id IS NULL
            OR EXISTS (SELECT 1 FROM focus_sessions s WHERE s.id = l.session_id)
          )",
    )?;

    Ok(())
}

fn rebuild_focus_sessions_table_if_needed(connection: &Connection) -> AppResult<()> {
    let has_todo_fk = table_has_foreign_key(connection, "focus_sessions", "todo_id", "todos")?;
    let project_id_nullable = table_column_allows_null(connection, "focus_sessions", "project_id")?;
    let todo_id_nullable = table_column_allows_null(connection, "focus_sessions", "todo_id")?;

    if has_todo_fk && project_id_nullable && todo_id_nullable {
        return Ok(());
    }

    rebuild_table(
        connection,
        "focus_sessions",
        "CREATE TABLE focus_sessions_new (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            todo_id TEXT,
            type TEXT NOT NULL,
            planned_duration_sec INTEGER NOT NULL,
            actual_duration_sec INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            result TEXT NOT NULL,
            interrupt_reason TEXT,
            FOREIGN KEY (todo_id, project_id) REFERENCES todos(id, project_id) ON DELETE CASCADE
        )",
        "INSERT INTO focus_sessions_new (
            id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
            started_at, ended_at, result, interrupt_reason
        )
        SELECT
            s.id,
            CASE WHEN s.type = 'focus' THEN s.project_id ELSE NULL END,
            CASE WHEN s.type = 'focus' THEN s.todo_id ELSE NULL END,
            s.type,
            s.planned_duration_sec,
            s.actual_duration_sec,
            s.started_at,
            s.ended_at,
            s.result,
            s.interrupt_reason
        FROM focus_sessions s
        WHERE s.type != 'focus'
           OR EXISTS (
                SELECT 1 FROM todos t WHERE t.id = s.todo_id AND t.project_id = s.project_id
           )",
    )
}

fn rebuild_table_if_foreign_keys_missing(
    connection: &Connection,
    table_name: &str,
    from_column: &str,
    to_table: &str,
    create_sql: &str,
    copy_sql: &str,
) -> AppResult<()> {
    if table_has_foreign_key(connection, table_name, from_column, to_table)? {
        return Ok(());
    }

    rebuild_table(connection, table_name, create_sql, copy_sql)
}

fn rebuild_table(
    connection: &Connection,
    table_name: &str,
    create_sql: &str,
    copy_sql: &str,
) -> AppResult<()> {
    let temp_table = format!("{table_name}_new");
    connection.execute_batch("BEGIN IMMEDIATE TRANSACTION;").map_err(to_string)?;

    let migration_result = (|| -> AppResult<()> {
        connection.execute_batch(create_sql).map_err(to_string)?;
        connection.execute(copy_sql, []).map_err(to_string)?;
        connection.execute(&format!("DROP TABLE {table_name}"), []).map_err(to_string)?;
        connection
            .execute(&format!("ALTER TABLE {temp_table} RENAME TO {table_name}"), [])
            .map_err(to_string)?;
        Ok(())
    })();

    if migration_result.is_ok() {
        connection.execute_batch("COMMIT").map_err(to_string)?;
    } else {
        let _ = connection.execute_batch("ROLLBACK");
    }

    migration_result
}

fn table_has_foreign_key(
    connection: &Connection,
    table_name: &str,
    from_column: &str,
    to_table: &str,
) -> AppResult<bool> {
    let pragma = format!("PRAGMA foreign_key_list({table_name})");
    let mut statement = connection.prepare(&pragma).map_err(to_string)?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(2)?, row.get::<_, String>(3)?)))
        .map_err(to_string)?;

    for row in rows {
        let (table, from) = row.map_err(to_string)?;
        if table == to_table && from == from_column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn table_column_allows_null(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> AppResult<bool> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection.prepare(&pragma).map_err(to_string)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(to_string)?;

    for row in rows {
        let (name, not_null) = row.map_err(to_string)?;
        if name == column_name {
            return Ok(not_null == 0);
        }
    }

    Err(format!("Column {column_name} not found in {table_name}."))
}

fn add_settings_column_if_missing(
    connection: &Connection,
    columns: &HashSet<String>,
    column_name: &str,
    definition: &str,
) -> AppResult<()> {
    add_column_if_missing(connection, columns, "settings", column_name, definition)
}

fn add_column_if_missing(
    connection: &Connection,
    columns: &HashSet<String>,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> AppResult<()> {
    if columns.contains(column_name) {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
            [],
        )
        .map_err(to_string)?;

    Ok(())
}

fn seed_if_empty(connection: &Connection) -> AppResult<()> {
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .map_err(to_string)?;
    if count > 0 {
        return Ok(());
    }

    let study_project_id = Uuid::new_v4().to_string();
    let product_project_id = Uuid::new_v4().to_string();
    let health_project_id = Uuid::new_v4().to_string();
    let reading_todo_id = Uuid::new_v4().to_string();
    let prototype_todo_id = Uuid::new_v4().to_string();
    let metric_todo_id = Uuid::new_v4().to_string();
    let walk_todo_id = Uuid::new_v4().to_string();
    let now = Local::now();

    connection
        .execute(
            "INSERT INTO projects (id, name, color, icon, status, created_at, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![study_project_id, "资格考试冲刺", "#C65D3D", "book", "active", iso_days(now, -12)],
        )
        .map_err(to_string)?;
    connection
        .execute(
            "INSERT INTO projects (id, name, color, icon, status, created_at, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![product_project_id, "桌面产品设计", "#1E4F5F", "spark", "active", iso_days(now, -7)],
        )
        .map_err(to_string)?;
    connection
        .execute(
            "INSERT INTO projects (id, name, color, icon, status, created_at, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![health_project_id, "体能恢复计划", "#5A6A31", "leaf", "paused", iso_days(now, -18)],
        )
        .map_err(to_string)?;

    connection
        .execute(
            "INSERT INTO todos (
                id, project_id, title, quick_start_step, description, notes, status, priority,
                estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json, current_step_index,
                created_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 4, 2, ?9, 1, ?10, 0, ?11, NULL)",
            params![
                reading_todo_id,
                study_project_id,
                "真题阅读 2 套",
                "先完成第一套真题的阅读部分。",
                "按题型拆解错题，记录生词。",
                "结束后整理高频词到单词本。",
                "in_progress",
                "high",
                date_days(now, 2),
                to_json_string(&vec!["按题型拆解错题，记录生词。".to_string()]).map_err(to_string)?,
                iso_days(now, -5)
            ],
        )
        .map_err(to_string)?;
    connection
        .execute(
            "INSERT INTO todos (
                id, project_id, title, quick_start_step, description, notes, status, priority,
                estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json, current_step_index,
                created_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 3, 0, ?9, 1, ?10, 0, ?11, NULL)",
            params![
                prototype_todo_id,
                product_project_id,
                "整理桌面端信息架构",
                "先盘点当前桌面端的页面入口。",
                "把导航、卡片和统计逻辑统一。",
                "优先确定执行页的信息密度。",
                "todo",
                "high",
                date_days(now, 1),
                to_json_string(&vec!["把导航、卡片和统计逻辑统一。".to_string()]).map_err(to_string)?,
                iso_days(now, -3)
            ],
        )
        .map_err(to_string)?;
    connection
        .execute(
            "INSERT INTO todos (
                id, project_id, title, quick_start_step, description, notes, status, priority,
                estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json, current_step_index,
                created_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, 2, 0, ?8, 0, ?9, 0, ?10, NULL)",
            params![
                metric_todo_id,
                product_project_id,
                "补统计页图表文案",
                "先列出现有图表和对应空白文案。",
                "把趋势图和项目占比的文案补齐。",
                "todo",
                "medium",
                date_days(now, 3),
                to_json_string(&vec!["把趋势图和项目占比的文案补齐。".to_string()]).map_err(to_string)?,
                iso_days(now, -2)
            ],
        )
        .map_err(to_string)?;
    connection
        .execute(
            "INSERT INTO todos (
                id, project_id, title, quick_start_step, description, notes, status, priority,
                estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json, current_step_index,
                created_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, 2, 0, NULL, 0, ?8, 0, ?9, NULL)",
            params![
                walk_todo_id,
                health_project_id,
                "轻量跑步 30 分钟",
                "先完成 3 分钟热身。",
                "恢复心肺，不追配速。",
                "todo",
                "low",
                to_json_string(&vec!["恢复心肺，不追配速。".to_string()]).map_err(to_string)?,
                iso_days(now, -4)
            ],
        )
        .map_err(to_string)?;

    let sessions = vec![
        (study_project_id.clone(), reading_todo_id.clone(), iso_days(now, -4), iso_days_hours(now, -4, 1), "completed", None::<String>, 1500),
        (study_project_id.clone(), reading_todo_id.clone(), iso_days_hours(now, -2, 2), iso_days_hours(now, -2, 3), "completed", None::<String>, 1500),
        (product_project_id.clone(), prototype_todo_id.clone(), iso_days_hours(now, -1, 4), iso_days_hours(now, -1, 5), "completed", None::<String>, 1500),
        (product_project_id.clone(), prototype_todo_id.clone(), iso_days_hours(now, -1, 1), iso_days_hours(now, -1, 2), "interrupted", Some("被临时会议打断".to_string()), 900),
        (study_project_id.clone(), reading_todo_id.clone(), iso_days_hours(now, 0, 1), iso_days_hours(now, 0, 2), "completed", None::<String>, 1500),
    ];

    for (project_id, todo_id, started_at, ended_at, result, interrupt_reason, actual_duration) in sessions {
        connection
            .execute(
                "INSERT INTO focus_sessions (
                    id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
                    started_at, ended_at, result, interrupt_reason
                 ) VALUES (?1, ?2, ?3, 'focus', 1500, ?4, ?5, ?6, ?7, ?8)",
                params![
                    Uuid::new_v4().to_string(),
                    project_id,
                    todo_id,
                    actual_duration,
                    started_at,
                    ended_at,
                    result,
                    interrupt_reason
                ],
            )
            .map_err(to_string)?;
    }

    Ok(())
}

fn iso_days(base: chrono::DateTime<Local>, offset_days: i64) -> String {
    (base + Duration::days(offset_days)).to_rfc3339()
}

fn iso_days_hours(base: chrono::DateTime<Local>, offset_days: i64, offset_hours: i64) -> String {
    (base + Duration::days(offset_days) + Duration::hours(offset_hours)).to_rfc3339()
}

fn date_days(base: chrono::DateTime<Local>, offset_days: i64) -> String {
    let date = base + Duration::days(offset_days);
    date.format("%Y-%m-%d").to_string()
}

fn bool_to_int(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

fn normalize_pomodoro_count(value: i64) -> i64 {
    value.max(1)
}

fn archived_at_for_status(status: &str, timestamp: &str) -> Option<String> {
    if status == "archived" {
        Some(timestamp.to_string())
    } else {
        None
    }
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        clear_all_data_with_connection, create_schema, ensure_settings, insert_focus_feedback_log,
        load_settings_from_connection, load_snapshot_from_connection,
        prepare_focus_feedback_log_with_connection, record_focus_session_with_connection,
        save_focus_feedback_log_with_connection, save_settings_with_connection,
        save_todo_with_connection, seed_if_empty, table_column_allows_null,
    };
    use crate::models::{
        FocusFeedbackDraft, FocusFeedbackLog, SaveAppSettingsInput, TodoDraft,
        FocusSessionDraft,
    };
    use rusqlite::{params, Connection};

    #[test]
    fn create_schema_migrates_legacy_tables_and_enables_cascade_deletes() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_legacy_relational_schema(&connection);
        insert_project(&connection, "project-1");
        insert_todo(&connection, "todo-1", "project-1", 0, 1, "todo");
        insert_focus_session(&connection, "session-1", "project-1", "todo-1");
        insert_focus_feedback_log(
            &connection,
            &FocusFeedbackLog {
                id: "log-1".to_string(),
                project_id: "project-1".to_string(),
                todo_id: "todo-1".to_string(),
                session_id: Some("session-1".to_string()),
                completed_text: "完成了旧日志迁移".to_string(),
                issue_text: String::new(),
                risk_text: String::new(),
                created_at: "2026-04-05T09:30:00Z".to_string(),
            },
        )
        .expect("feedback log should insert");

        create_schema(&connection).expect("schema migration should succeed");

        connection
            .execute("DELETE FROM todos WHERE id = ?1", params!["todo-1"])
            .expect("todo delete should succeed");

        assert!(foreign_key_exists(&connection, "todos", "project_id", "projects", "CASCADE"));
        assert!(foreign_key_exists(
            &connection,
            "focus_sessions",
            "todo_id",
            "todos",
            "CASCADE",
        ));
        assert!(foreign_key_exists(
            &connection,
            "focus_feedback_logs",
            "session_id",
            "focus_sessions",
            "CASCADE",
        ));
        assert_eq!(count_rows(&connection, "focus_sessions"), 0);
        assert_eq!(count_rows(&connection, "focus_feedback_logs"), 0);
    }

    #[test]
    fn create_schema_migrates_legacy_focus_sessions_to_nullable_links_for_breaks() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_legacy_relational_schema(&connection);
        insert_project(&connection, "project-1");
        insert_todo(&connection, "todo-1", "project-1", 0, 1, "todo");
        insert_legacy_break_session(&connection, "break-1", "project-1", "todo-1");

        create_schema(&connection).expect("schema migration should succeed");

        let session_state = connection
            .query_row(
                "SELECT project_id, todo_id, type FROM focus_sessions WHERE id = ?1",
                params!["break-1"],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("break session should remain after migration");

        assert_eq!(session_state, (None, None, "short_break".to_string()));
        assert!(table_column_allows_null(&connection, "focus_sessions", "project_id").expect("project_id should exist"));
        assert!(table_column_allows_null(&connection, "focus_sessions", "todo_id").expect("todo_id should exist"));
    }

    #[test]
    fn save_todo_with_connection_rejects_unknown_project() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");

        let error = save_todo_with_connection(
            &connection,
            TodoDraft {
                id: None,
                project_id: "missing-project".to_string(),
                title: "Write regression test".to_string(),
                quick_start_step: "Open db.rs".to_string(),
                description: "Add a focused failing test.".to_string(),
                notes: String::new(),
                status: "todo".to_string(),
                priority: "high".to_string(),
                estimated_pomodoros: 1,
                due_date: None,
                is_today: false,
                steps: vec!["Add the test first".to_string()],
                current_step_index: 0,
            },
        )
        .expect_err("missing project should be rejected");

        assert_eq!(error, "Project not found.");
        assert_eq!(count_rows(&connection, "todos"), 0);
    }

    #[test]
    fn record_focus_session_with_connection_rejects_project_todo_mismatch_without_partial_writes() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        insert_project(&connection, "project-1");
        insert_project(&connection, "project-2");
        insert_todo(&connection, "todo-1", "project-1", 0, 1, "todo");

        let error = record_focus_session_with_connection(
            &mut connection,
            FocusSessionDraft {
                project_id: Some("project-2".to_string()),
                todo_id: Some("todo-1".to_string()),
                r#type: "focus".to_string(),
                planned_duration_sec: 1500,
                actual_duration_sec: 1500,
                started_at: "2026-04-05T09:00:00Z".to_string(),
                ended_at: Some("2026-04-05T09:25:00Z".to_string()),
                result: "completed".to_string(),
                interrupt_reason: None,
            },
        )
        .expect_err("mismatched project/todo should be rejected");

        assert_eq!(error, "Todo does not belong to project.");
        assert_eq!(count_rows(&connection, "focus_sessions"), 0);
        let todo_state = connection
            .query_row(
                "SELECT completed_pomodoros, status FROM todos WHERE id = ?1",
                params!["todo-1"],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("todo should still exist");
        assert_eq!(todo_state, (0, "todo".to_string()));
    }

    #[test]
    fn record_focus_session_with_connection_allows_break_session_without_todo_link_and_keeps_todo_state() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        insert_project(&connection, "project-1");
        insert_todo(&connection, "todo-1", "project-1", 1, 3, "in_progress");

        record_focus_session_with_connection(
            &mut connection,
            FocusSessionDraft {
                project_id: None,
                todo_id: None,
                r#type: "short_break".to_string(),
                planned_duration_sec: 300,
                actual_duration_sec: 240,
                started_at: "2026-04-05T10:00:00Z".to_string(),
                ended_at: Some("2026-04-05T10:04:00Z".to_string()),
                result: "completed".to_string(),
                interrupt_reason: None,
            },
        )
        .expect("break session should record without todo linkage");

        assert_eq!(count_rows(&connection, "focus_sessions"), 1);
        let session_state = connection
            .query_row(
                "SELECT project_id, todo_id, type FROM focus_sessions LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("break session should persist");
        assert_eq!(session_state, (None, None, "short_break".to_string()));

        let todo_state = connection
            .query_row(
                "SELECT completed_pomodoros, status FROM todos WHERE id = ?1",
                params!["todo-1"],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("todo should still exist");
        assert_eq!(todo_state, (1, "in_progress".to_string()));
    }

    #[test]
    fn record_focus_session_with_connection_increments_completed_pomodoros_once() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        insert_project(&connection, "project-1");
        insert_todo(&connection, "todo-1", "project-1", 1, 2, "in_progress");

        record_focus_session_with_connection(
            &mut connection,
            FocusSessionDraft {
                project_id: Some("project-1".to_string()),
                todo_id: Some("todo-1".to_string()),
                r#type: "focus".to_string(),
                planned_duration_sec: 1500,
                actual_duration_sec: 1500,
                started_at: "2026-04-05T09:30:00Z".to_string(),
                ended_at: Some("2026-04-05T09:55:00Z".to_string()),
                result: "completed".to_string(),
                interrupt_reason: None,
            },
        )
        .expect("completed focus session should record successfully");

        assert_eq!(count_rows(&connection, "focus_sessions"), 1);
        let todo_state = connection
            .query_row(
                "SELECT completed_pomodoros, status, completed_at FROM todos WHERE id = ?1",
                params!["todo-1"],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("todo should still exist");
        assert_eq!(todo_state.0, 2);
        assert_eq!(todo_state.1, "done".to_string());
        assert!(todo_state.2.is_some());
    }

    #[test]
    fn prepare_focus_feedback_log_with_connection_validates_without_persisting() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        insert_project(&connection, "project-1");
        insert_todo(&connection, "todo-1", "project-1", 0, 1, "in_progress");
        insert_focus_session(&connection, "session-1", "project-1", "todo-1");

        let record = prepare_focus_feedback_log_with_connection(
            &connection,
            FocusFeedbackDraft {
                project_id: "project-1".to_string(),
                todo_id: "todo-1".to_string(),
                session_id: Some("session-1".to_string()),
                completed_text: "补齐事务测试".to_string(),
                issue_text: "旧日志重复".to_string(),
                risk_text: "还没做迁移".to_string(),
            },
        )
        .expect("feedback should validate");

        assert_eq!(count_rows(&connection, "focus_feedback_logs"), 0);

        insert_focus_feedback_log(&connection, &record).expect("prepared feedback should persist");

        assert_eq!(count_rows(&connection, "focus_feedback_logs"), 1);
    }

    #[test]
    fn save_focus_feedback_log_with_connection_returns_existing_match_without_duplicate_insert() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        insert_project(&connection, "project-1");
        insert_todo(&connection, "todo-1", "project-1", 0, 1, "in_progress");
        insert_focus_session(&connection, "session-1", "project-1", "todo-1");

        let first = save_focus_feedback_log_with_connection(
            &connection,
            FocusFeedbackDraft {
                project_id: "project-1".to_string(),
                todo_id: "todo-1".to_string(),
                session_id: Some("session-1".to_string()),
                completed_text: "已完成接口联调".to_string(),
                issue_text: "列表刷新慢".to_string(),
                risk_text: "验收时关注空态".to_string(),
            },
        )
        .expect("first feedback should persist");

        let second = save_focus_feedback_log_with_connection(
            &connection,
            FocusFeedbackDraft {
                project_id: "project-1".to_string(),
                todo_id: "todo-1".to_string(),
                session_id: Some("session-1".to_string()),
                completed_text: "已完成接口联调".to_string(),
                issue_text: "列表刷新慢".to_string(),
                risk_text: "验收时关注空态".to_string(),
            },
        )
        .expect("duplicate feedback should reuse the existing row");

        assert_eq!(count_rows(&connection, "focus_feedback_logs"), 1);
        assert_eq!(second.id, first.id);
        assert_eq!(second.created_at, first.created_at);
    }

    #[test]
    fn save_focus_feedback_log_with_connection_deduplicates_null_session_feedback() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        insert_project(&connection, "project-1");
        insert_todo(&connection, "todo-1", "project-1", 0, 1, "in_progress");

        let first = save_focus_feedback_log_with_connection(
            &connection,
            FocusFeedbackDraft {
                project_id: "project-1".to_string(),
                todo_id: "todo-1".to_string(),
                session_id: None,
                completed_text: "整理了阻塞点".to_string(),
                issue_text: String::new(),
                risk_text: "下一轮先拆小任务".to_string(),
            },
        )
        .expect("first feedback should persist");

        let second = save_focus_feedback_log_with_connection(
            &connection,
            FocusFeedbackDraft {
                project_id: "project-1".to_string(),
                todo_id: "todo-1".to_string(),
                session_id: None,
                completed_text: "整理了阻塞点".to_string(),
                issue_text: String::new(),
                risk_text: "下一轮先拆小任务".to_string(),
            },
        )
        .expect("duplicate null-session feedback should reuse the existing row");

        assert_eq!(count_rows(&connection, "focus_feedback_logs"), 1);
        assert_eq!(second.id, first.id);
    }

    #[test]
    fn load_snapshot_from_connection_redacts_plaintext_api_key() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        connection
            .execute(
                "UPDATE settings SET ai_base_url = ?1, ai_api_key = ?2, ai_model_id = ?3 WHERE id = 1",
                params!["https://api.example.com/v1", "super-secret", "gpt-4.1-mini"],
            )
            .expect("settings should update");

        let snapshot = load_snapshot_from_connection(&connection).expect("snapshot should load");
        let settings_json = serde_json::to_value(&snapshot.settings).expect("settings should serialize");

        assert_eq!(settings_json.get("aiApiKey"), None);
        assert_eq!(settings_json.get("aiApiKeyConfigured"), Some(&serde_json::Value::Bool(true)));
    }

    #[test]
    fn load_settings_from_connection_returns_plaintext_api_key_for_internal_use() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        connection
            .execute(
                "UPDATE settings SET ai_base_url = ?1, ai_api_key = ?2, ai_model_id = ?3 WHERE id = 1",
                params!["https://api.example.com/v1", "super-secret", "gpt-4.1-mini"],
            )
            .expect("settings should update");

        let internal_settings = load_settings_from_connection(&connection).expect("internal settings should load");

        assert_eq!(internal_settings.ai_api_key, "super-secret");
        assert_eq!(internal_settings.ai_base_url, "https://api.example.com/v1");
        assert_eq!(internal_settings.ai_model_id, "gpt-4.1-mini");
    }

    #[test]
    fn clear_all_data_with_connection_removes_business_data_and_resets_settings() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        seed_if_empty(&connection).expect("sample data should seed");
        connection
            .execute(
                "INSERT INTO focus_sessions (
                    id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
                    started_at, ended_at, result, interrupt_reason
                 ) VALUES (?1, NULL, NULL, 'short_break', 300, 300, ?2, ?3, 'completed', NULL)",
                params![
                    "break-session-1",
                    "2026-04-05T11:00:00Z",
                    "2026-04-05T11:05:00Z"
                ],
            )
            .expect("break session should insert");
        connection
            .execute(
                "UPDATE settings
                 SET focus_minutes = 45, short_break_minutes = 10, long_break_minutes = 20,
                     long_break_interval = 3, auto_start_breaks = 0, auto_start_focus = 1,
                     notifications_enabled = 0, minimize_to_tray = 0, launch_on_startup = 1, sound_enabled = 0,
                     ai_base_url = ?1, ai_api_key = ?2, ai_model_id = ?3
                 WHERE id = 1",
                params!["https://api.example.com/v1", "super-secret", "gpt-4.1-mini"],
            )
            .expect("settings should update");
        connection
            .execute(
                "INSERT INTO ai_reviews (
                    id, scope, project_id, project_name, timeframe, created_at,
                    summary_json, issues_json, suggestions_json
                 ) VALUES (?1, 'project', ?2, '资格考试冲刺', 'week', ?3, ?4, ?5, ?6)",
                params![
                    "review-1",
                    "study-project",
                    "2026-04-05T12:00:00Z",
                    "[\"完成了 3 次专注\"]",
                    "[\"中断偏多\"]",
                    "[\"下周先做阅读真题\"]"
                ],
            )
            .expect("ai review should insert");

        clear_all_data_with_connection(&mut connection).expect("clear all data should succeed");

        assert_eq!(count_rows(&connection, "projects"), 0);
        assert_eq!(count_rows(&connection, "todos"), 0);
        assert_eq!(count_rows(&connection, "focus_sessions"), 0);
        assert_eq!(count_rows(&connection, "focus_feedback_logs"), 0);
        assert_eq!(count_rows(&connection, "ai_reviews"), 0);

        let internal_settings = load_settings_from_connection(&connection).expect("settings should remain available");
        assert_eq!(internal_settings.focus_minutes, 25);
        assert_eq!(internal_settings.short_break_minutes, 5);
        assert_eq!(internal_settings.long_break_minutes, 15);
        assert_eq!(internal_settings.long_break_interval, 4);
        assert!(internal_settings.auto_start_breaks);
        assert!(!internal_settings.auto_start_focus);
        assert!(internal_settings.notifications_enabled);
        assert!(internal_settings.minimize_to_tray);
        assert!(!internal_settings.launch_on_startup);
        assert!(internal_settings.sound_enabled);
        assert_eq!(internal_settings.ai_base_url, "");
        assert_eq!(internal_settings.ai_api_key, "");
        assert_eq!(internal_settings.ai_model_id, "");

        let snapshot = load_snapshot_from_connection(&connection).expect("snapshot should load after clear");
        assert!(snapshot.projects.is_empty());
        assert!(snapshot.todos.is_empty());
        assert!(snapshot.sessions.is_empty());
        let settings_json = serde_json::to_value(&snapshot.settings).expect("settings should serialize");
        assert_eq!(settings_json.get("aiApiKey"), None);
        assert_eq!(settings_json.get("aiApiKeyConfigured"), Some(&serde_json::Value::Bool(false)));
    }

    #[test]
    fn clear_all_data_with_connection_is_idempotent() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        seed_if_empty(&connection).expect("sample data should seed");

        clear_all_data_with_connection(&mut connection).expect("first clear should succeed");
        clear_all_data_with_connection(&mut connection).expect("second clear should also succeed");

        assert_eq!(count_rows(&connection, "projects"), 0);
        assert_eq!(count_rows(&connection, "todos"), 0);
        assert_eq!(count_rows(&connection, "focus_sessions"), 0);
        assert_eq!(count_rows(&connection, "focus_feedback_logs"), 0);
        assert_eq!(count_rows(&connection, "ai_reviews"), 0);
        assert_eq!(count_rows(&connection, "settings"), 1);
    }

    #[test]
    fn save_settings_with_connection_replaces_api_key_and_returns_redacted_snapshot() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        connection
            .execute(
                "UPDATE settings SET ai_base_url = ?1, ai_api_key = ?2, ai_model_id = ?3 WHERE id = 1",
                params!["https://api.example.com/v1", "old-secret", "gpt-4.1-mini"],
            )
            .expect("settings should seed configured key");

        let snapshot = save_settings_with_connection(
            &connection,
            SaveAppSettingsInput {
                focus_minutes: 25,
                short_break_minutes: 5,
                long_break_minutes: 15,
                long_break_interval: 4,
                auto_start_breaks: true,
                auto_start_focus: false,
                notifications_enabled: true,
                minimize_to_tray: true,
                launch_on_startup: false,
                sound_enabled: true,
                ai_base_url: "https://api.example.com/v1".to_string(),
                ai_api_key: "new-secret".to_string(),
                ai_model_id: "gpt-4.1-mini".to_string(),
            },
        )
        .expect("settings should save");

        let internal_settings = load_settings_from_connection(&connection).expect("internal settings should load");

        assert_eq!(internal_settings.ai_api_key, "new-secret");
        let settings_json = serde_json::to_value(&snapshot.settings).expect("settings should serialize");
        assert_eq!(settings_json.get("aiApiKey"), None);
        assert_eq!(settings_json.get("aiApiKeyConfigured"), Some(&serde_json::Value::Bool(true)));
    }

    #[test]
    fn save_settings_with_connection_preserves_existing_api_key_when_input_is_empty() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        create_schema(&connection).expect("schema should initialize");
        ensure_settings(&connection).expect("settings should initialize");
        connection
            .execute(
                "UPDATE settings SET ai_base_url = ?1, ai_api_key = ?2, ai_model_id = ?3 WHERE id = 1",
                params!["https://api.example.com/v1", "persist-me", "gpt-4.1-mini"],
            )
            .expect("settings should seed configured key");

        let snapshot = save_settings_with_connection(
            &connection,
            SaveAppSettingsInput {
                focus_minutes: 25,
                short_break_minutes: 5,
                long_break_minutes: 15,
                long_break_interval: 4,
                auto_start_breaks: true,
                auto_start_focus: false,
                notifications_enabled: true,
                minimize_to_tray: true,
                launch_on_startup: false,
                sound_enabled: true,
                ai_base_url: "https://api.example.com/v1".to_string(),
                ai_api_key: String::new(),
                ai_model_id: "gpt-4.1-mini".to_string(),
            },
        )
        .expect("settings should save");

        let internal_settings = load_settings_from_connection(&connection).expect("internal settings should load");

        assert_eq!(internal_settings.ai_api_key, "persist-me");
        let settings_json = serde_json::to_value(&snapshot.settings).expect("settings should serialize");
        assert_eq!(settings_json.get("aiApiKey"), None);
        assert_eq!(settings_json.get("aiApiKeyConfigured"), Some(&serde_json::Value::Bool(true)));
    }

    fn create_legacy_relational_schema(connection: &Connection) {
        connection
            .execute_batch(
                "
                CREATE TABLE projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    color TEXT NOT NULL,
                    icon TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    archived_at TEXT
                );

                CREATE TABLE todos (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    quick_start_step TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    priority TEXT NOT NULL,
                    estimated_pomodoros INTEGER NOT NULL,
                    completed_pomodoros INTEGER NOT NULL DEFAULT 0,
                    due_date TEXT,
                    is_today INTEGER NOT NULL DEFAULT 0,
                    steps_json TEXT NOT NULL DEFAULT '[]',
                    current_step_index INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    completed_at TEXT
                );

                CREATE TABLE focus_sessions (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    todo_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    planned_duration_sec INTEGER NOT NULL,
                    actual_duration_sec INTEGER NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    result TEXT NOT NULL,
                    interrupt_reason TEXT
                );

                CREATE TABLE focus_feedback_logs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    todo_id TEXT NOT NULL,
                    session_id TEXT,
                    completed_text TEXT NOT NULL,
                    issue_text TEXT NOT NULL DEFAULT '',
                    risk_text TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                ",
            )
            .expect("legacy schema should initialize");
    }

    fn insert_project(connection: &Connection, project_id: &str) {
        connection
            .execute(
                "INSERT INTO projects (id, name, color, icon, status, created_at, archived_at)
                 VALUES (?1, 'Project', '#000000', 'book', 'active', '2026-04-05T00:00:00Z', NULL)",
                params![project_id],
            )
            .expect("project should insert");
    }

    fn insert_todo(
        connection: &Connection,
        todo_id: &str,
        project_id: &str,
        completed_pomodoros: i64,
        estimated_pomodoros: i64,
        status: &str,
    ) {
        connection
            .execute(
                "INSERT INTO todos (
                    id, project_id, title, quick_start_step, description, notes, status, priority,
                    estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json,
                    current_step_index, created_at, completed_at
                 ) VALUES (?1, ?2, 'Todo', 'Start', 'Desc', '', ?3, 'high', ?4, ?5, NULL, 0, '[]', 0, '2026-04-05T00:00:00Z', NULL)",
                params![todo_id, project_id, status, estimated_pomodoros, completed_pomodoros],
            )
            .expect("todo should insert");
    }

    fn insert_focus_session(connection: &Connection, session_id: &str, project_id: &str, todo_id: &str) {
        connection
            .execute(
                "INSERT INTO focus_sessions (
                    id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
                    started_at, ended_at, result, interrupt_reason
                 ) VALUES (?1, ?2, ?3, 'focus', 1500, 1500, '2026-04-05T09:00:00Z', '2026-04-05T09:25:00Z', 'completed', NULL)",
                params![session_id, project_id, todo_id],
            )
            .expect("session should insert");
    }

    fn insert_legacy_break_session(
        connection: &Connection,
        session_id: &str,
        project_id: &str,
        todo_id: &str,
    ) {
        connection
            .execute(
                "INSERT INTO focus_sessions (
                    id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
                    started_at, ended_at, result, interrupt_reason
                 ) VALUES (?1, ?2, ?3, 'short_break', 300, 300, '2026-04-05T10:00:00Z', '2026-04-05T10:05:00Z', 'completed', NULL)",
                params![session_id, project_id, todo_id],
            )
            .expect("legacy break session should insert");
    }

    fn foreign_key_exists(
        connection: &Connection,
        table_name: &str,
        from_column: &str,
        to_table: &str,
        on_delete: &str,
    ) -> bool {
        let pragma = format!("PRAGMA foreign_key_list({table_name})");
        let mut statement = connection.prepare(&pragma).expect("pragma should prepare");
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .expect("pragma should query")
            .collect::<Result<Vec<_>, _>>()
            .expect("pragma rows should collect");

        rows.into_iter().any(|(table, from, delete_action)| {
            table == to_table && from == from_column && delete_action.eq_ignore_ascii_case(on_delete)
        })
    }

    fn count_rows(connection: &Connection, table_name: &str) -> i64 {
        let sql = format!("SELECT COUNT(*) FROM {table_name}");
        connection
            .query_row(&sql, [], |row| row.get(0))
            .expect("count query should succeed")
    }
}
