use std::{collections::HashSet, fs, path::PathBuf};

use chrono::{Duration, Local, Utc};
use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde_json::{from_str, to_string as to_json_string};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::{
    AiReviewRecord, AiReviewRecordDraft, AppSettings, AppSnapshot, FocusSession, FocusSessionDraft,
    FocusFeedbackDraft, FocusFeedbackLog, Project, ProjectDraft, Todo, TodoDraft,
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
        .execute(
            "DELETE FROM focus_sessions WHERE project_id = ?1 OR todo_id IN (SELECT id FROM todos WHERE project_id = ?1)",
            params![project_id],
        )
        .map_err(to_string)?;
    connection
        .execute(
            "DELETE FROM todos WHERE project_id = ?1",
            params![project_id],
        )
        .map_err(to_string)?;
    connection
        .execute(
            "DELETE FROM projects WHERE id = ?1",
            params![project_id],
        )
        .map_err(to_string)?;

    load_snapshot_from_connection(&connection)
}

pub fn save_todo(app: &AppHandle, todo: TodoDraft) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    let now = Utc::now().to_rfc3339();
    let completed_at = if todo.status == "done" {
        Some(now.clone())
    } else {
        None
    };

    if let Some(id) = todo.id {
        let existing = connection
            .query_row(
                "SELECT completed_pomodoros, completed_at FROM todos WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(to_string)?
            .unwrap_or((0, None));

        let next_completed_at = if todo.status == "done" {
            existing.1.or(completed_at)
        } else {
            None
        };

        connection
            .execute(
                "UPDATE todos
                 SET project_id = ?2, title = ?3, quick_start_step = ?4, description = ?5, notes = ?6, status = ?7,
                     priority = ?8, estimated_pomodoros = ?9, due_date = ?10, is_today = ?11, steps_json = ?12,
                     current_step_index = ?13, completed_at = ?14
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
                    normalize_pomodoro_count(todo.estimated_pomodoros),
                    todo.due_date,
                    bool_to_int(todo.is_today),
                    to_json_string(&todo.steps).map_err(to_string)?,
                    todo.current_step_index,
                    next_completed_at
                ],
            )
            .map_err(to_string)?;
    } else {
        connection
            .execute(
                "INSERT INTO todos (
                    id, project_id, title, quick_start_step, description, notes, status, priority,
                    estimated_pomodoros, completed_pomodoros, due_date, is_today, steps_json, current_step_index,
                    created_at, completed_at
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
                    normalize_pomodoro_count(todo.estimated_pomodoros),
                    todo.due_date,
                    bool_to_int(todo.is_today),
                    to_json_string(&todo.steps).map_err(to_string)?,
                    todo.current_step_index,
                    now,
                    completed_at
                ],
            )
            .map_err(to_string)?;
    }

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

pub fn save_settings(app: &AppHandle, settings: AppSettings) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
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
                settings.ai_api_key,
                settings.ai_model_id
            ],
        )
        .map_err(to_string)?;
    load_snapshot_from_connection(&connection)
}

pub fn record_focus_session(app: &AppHandle, session: FocusSessionDraft) -> AppResult<AppSnapshot> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;

    connection
        .execute(
            "INSERT INTO focus_sessions (
                id, project_id, todo_id, type, planned_duration_sec, actual_duration_sec,
                started_at, ended_at, result, interrupt_reason
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                Uuid::new_v4().to_string(),
                session.project_id,
                session.todo_id,
                session.r#type,
                session.planned_duration_sec,
                session.actual_duration_sec,
                session.started_at,
                session.ended_at,
                session.result,
                session.interrupt_reason
            ],
        )
        .map_err(to_string)?;

    if session.r#type == "focus" && session.result == "completed" {
        let current = connection
            .query_row(
                "SELECT completed_pomodoros, estimated_pomodoros FROM todos WHERE id = ?1",
                params![session.todo_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(to_string)?;

        if let Some((completed, estimated)) = current {
            let next_completed = completed + 1;
            let done = next_completed >= estimated;
            connection
                .execute(
                    "UPDATE todos
                     SET completed_pomodoros = ?2, status = ?3, completed_at = ?4
                     WHERE id = ?1",
                    params![
                        session.todo_id,
                        next_completed,
                        if done { "done" } else { "in_progress" },
                        if done { session.ended_at } else { None }
                    ],
                )
                .map_err(to_string)?;
        }
    } else if session.r#type == "focus" && session.result == "interrupted" {
        connection
            .execute(
                "UPDATE todos
                 SET status = CASE WHEN status = 'todo' THEN 'in_progress' ELSE status END
                 WHERE id = ?1",
                params![session.todo_id],
            )
            .map_err(to_string)?;
    }

    load_snapshot_from_connection(&connection)
}

pub fn should_minimize_to_tray(app: &AppHandle) -> AppResult<bool> {
    let connection = connection(app)?;
    create_schema(&connection)?;
    ensure_settings(&connection)?;
    Ok(load_settings_from_connection(&connection)?.minimize_to_tray)
}

pub fn load_settings(app: &AppHandle) -> AppResult<AppSettings> {
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

    let completed_text = feedback.completed_text.trim().to_string();
    let issue_text = feedback.issue_text.trim().to_string();
    let risk_text = feedback.risk_text.trim().to_string();

    if completed_text.is_empty() {
        return Err("请先填写本轮已完成内容".to_string());
    }

    let todo_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM todos WHERE id = ?1 AND project_id = ?2",
            params![feedback.todo_id, feedback.project_id],
            |row| row.get(0),
        )
        .map_err(to_string)?;
    if todo_count == 0 {
        return Err("当前任务已变更，请重新选择后再生成".to_string());
    }

    if let Some(session_id) = feedback.session_id.as_ref() {
        let session_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM focus_sessions WHERE id = ?1 AND todo_id = ?2 AND project_id = ?3",
                params![session_id, feedback.todo_id, feedback.project_id],
                |row| row.get(0),
            )
            .map_err(to_string)?;
        if session_count == 0 {
            return Err("关联的番茄记录不存在，请重新生成".to_string());
        }
    }

    let record = FocusFeedbackLog {
        id: Uuid::new_v4().to_string(),
        project_id: feedback.project_id,
        todo_id: feedback.todo_id,
        session_id: feedback.session_id,
        completed_text,
        issue_text,
        risk_text,
        created_at: Utc::now().to_rfc3339(),
    };

    connection
        .execute(
            "INSERT INTO focus_feedback_logs (
                id, project_id, todo_id, session_id, completed_text, issue_text, risk_text, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id,
                record.project_id,
                record.todo_id,
                record.session_id,
                record.completed_text,
                record.issue_text,
                record.risk_text,
                record.created_at,
            ],
        )
        .map_err(to_string)?;

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

fn load_snapshot_from_connection(connection: &Connection) -> AppResult<AppSnapshot> {
    Ok(AppSnapshot {
        settings: load_settings_from_connection(connection)?,
        projects: load_projects(connection)?,
        todos: load_todos(connection)?,
        sessions: load_sessions(connection)?,
    })
}

fn load_settings_from_connection(connection: &Connection) -> AppResult<AppSettings> {
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
                Ok(AppSettings {
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
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS focus_sessions (
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
                created_at TEXT NOT NULL
            );
            ",
        )
        .map_err(to_string)?;
    migrate_settings_schema(connection)?;
    migrate_todos_schema(connection)?;
    Ok(())
}

fn ensure_settings(connection: &Connection) -> AppResult<()> {
    connection
        .execute(
            "INSERT OR IGNORE INTO settings (
                id, focus_minutes, short_break_minutes, long_break_minutes, long_break_interval,
                auto_start_breaks, auto_start_focus, notifications_enabled, minimize_to_tray,
                launch_on_startup, sound_enabled, ai_base_url, ai_api_key, ai_model_id
             ) VALUES (1, 25, 5, 15, 4, 1, 0, 1, 1, 0, 1, '', '', '')",
            [],
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
