use std::{
    collections::{BTreeMap, HashMap, HashSet},
    time::Duration,
};

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    db,
    models::{
        AiReviewSummary, AppSettings, FocusContinuationSuggestion, FocusFeedbackDraft,
        FocusFeedbackLog, FocusSession, Project, Todo, TodoActivationRelief, TodoAiSuggestion,
        TodoActivationReliefRequest,
    },
};

type AppResult<T> = Result<T, String>;

const AI_TIMEOUT_SECONDS: u64 = 90;
const AI_REVIEW_MINIMUM_FOCUS_SESSIONS: usize = 5;
const AI_REVIEW_WINDOW_DAYS: i64 = 7;
const FOCUS_CONTINUATION_HISTORY_LIMIT: i64 = 10;
const TODO_AI_SYSTEM_PROMPT: &str = "You rewrite todo descriptions for a pomodoro planning app.
Return JSON only.
For each todo, preserve the original intent, create one minimal starting step, then create clear follow-up steps.
quickStartStep must stay on the title's primary action path.
Do not replace the main action with generic preparation such as reading docs, browsing overview pages, collecting materials, or reviewing background, unless the todo itself is explicitly about reading, researching, or reviewing.
If the todo says to use AI, ask AI, generate with AI, or practice with AI, quickStartStep must directly involve opening that AI tool or chat and sending a concrete request.
updatedDescription must continue the same thread as quickStartStep and must not jump to a different phase.
Do not include markdown code fences.
Do not omit any todo.
The response must be either a JSON array or an object with an \"items\" array.
Each item must contain:
- todoId: string
- quickStartStep: string
- updatedDescription: string";
const ACTIVATION_RELIEF_SYSTEM_PROMPT: &str = "You help a user start one todo in a pomodoro planning app.
Return JSON only.
Use only the evidence provided in the input.
Do not guess hidden blockers or personal habits.
Respect the stated blocker reason and refinement mode.
If previous relief is provided:
- mode need_smaller: make the new quickStartStep smaller and more immediate than before.
- mode need_alternative: avoid rephrasing the previous relief and choose a different angle.
Produce one extremely small starting step, aligned follow-up steps, and one backup action if the user still feels stuck.
The response must be a JSON object with:
- quickStartStep: string
- updatedDescription: string
- fallbackStep: string";
const REVIEW_AI_SYSTEM_PROMPT: &str = "You write weekly review summaries for a pomodoro planning app.
Return JSON only.
Use only the evidence provided by the input data.
Do not guess hidden causes, emotions, or habits.
Keep every line concise, concrete, and actionable.
The response must be a JSON object with:
- summary: string[]
- issues: string[]
- suggestions: string[]
Each array must contain 2 to 4 short items.";
const FOCUS_CONTINUATION_SYSTEM_PROMPT: &str = "You help continue work after a pomodoro ends.
Return JSON only.
Use only evidence from the input.
Do not infer hidden personal traits or tools.
Output schema:
- quickStartStep: string (single smallest action to restart immediately)
- nextSteps: string[] (2 to 4 concise follow-up steps)
- fallbackStep: string (what to do if stuck again)";

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
    content: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTodoAiSuggestion {
    todo_id: String,
    quick_start_step: String,
    updated_description: String,
}

#[derive(Debug, Deserialize)]
struct RawTodoAiSuggestionEnvelope {
    items: Vec<RawTodoAiSuggestion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTodoActivationRelief {
    quick_start_step: String,
    updated_description: String,
    fallback_step: String,
}

#[derive(Debug, Deserialize)]
struct RawAiReviewSummary {
    summary: Vec<String>,
    issues: Vec<String>,
    suggestions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFocusContinuationSuggestion {
    quick_start_step: String,
    next_steps: Vec<String>,
    fallback_step: String,
}

pub async fn generate_todo_ai_suggestions(
    app: &AppHandle,
    project_id: &str,
    todo_ids: &[String],
) -> AppResult<Vec<TodoAiSuggestion>> {
    let snapshot = db::load_snapshot(app)?;
    validate_ai_settings(&snapshot.settings)?;

    let project = snapshot
        .projects
        .into_iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "Project not found.".to_string())?;

    if project.status == "archived" {
        return Err("Archived projects cannot use AI enhancement.".to_string());
    }

    if todo_ids.is_empty() {
        return Err("No todos were selected for AI enhancement.".to_string());
    }

    let requested_todo_ids = todo_ids.iter().cloned().collect::<HashSet<_>>();
    let todos = snapshot
        .todos
        .into_iter()
        .filter(|todo| {
            todo.project_id == project.id
                && requested_todo_ids.contains(&todo.id)
                && matches!(todo.status.as_str(), "todo" | "in_progress")
        })
        .collect::<Vec<_>>();

    if todos.len() != requested_todo_ids.len() {
        return Err(
            "Some selected todos are invalid, archived, or no longer belong to this project."
                .to_string(),
        );
    }

    let content = request_chat_completion(
        &snapshot.settings,
        TODO_AI_SYSTEM_PROMPT,
        build_todo_user_prompt(&project.name, &todos),
    )
    .await?;
    let raw_suggestions = parse_todo_suggestions(&content)?;

    validate_todo_suggestions(todos, raw_suggestions)
}

pub async fn generate_ai_review(
    app: &AppHandle,
    project_id: Option<&str>,
) -> AppResult<AiReviewSummary> {
    let snapshot = db::load_snapshot(app)?;
    validate_ai_settings(&snapshot.settings)?;

    let scoped_project = match project_id {
        Some(id) => Some(
            snapshot
                .projects
                .iter()
                .find(|project| project.id == id)
                .cloned()
                .ok_or_else(|| "Project not found.".to_string())?,
        ),
        None => None,
    };

    let now = Utc::now();
    let window_start = now - ChronoDuration::days(AI_REVIEW_WINDOW_DAYS);
    let scoped_todos = snapshot
        .todos
        .iter()
        .filter(|todo| project_id.map(|id| todo.project_id == id).unwrap_or(true))
        .cloned()
        .collect::<Vec<_>>();

    if scoped_todos.is_empty() {
        return Err("当前范围内还没有可复盘的任务数据".to_string());
    }

    let recent_focus_sessions = snapshot
        .sessions
        .iter()
        .filter(|session| is_recent_session(session, project_id, &window_start, "focus", "completed"))
        .cloned()
        .collect::<Vec<_>>();
    if recent_focus_sessions.len() < AI_REVIEW_MINIMUM_FOCUS_SESSIONS {
        return Err(format!(
            "近 7 天至少完成 {} 次专注后才能生成 AI 复盘",
            AI_REVIEW_MINIMUM_FOCUS_SESSIONS
        ));
    }

    let recent_interrupted_sessions = snapshot
        .sessions
        .iter()
        .filter(|session| is_recent_session(session, project_id, &window_start, "focus", "interrupted"))
        .cloned()
        .collect::<Vec<_>>();

    let content = request_chat_completion(
        &snapshot.settings,
        REVIEW_AI_SYSTEM_PROMPT,
        build_review_user_prompt(
            scoped_project.as_ref(),
            &snapshot.projects,
            &scoped_todos,
            &recent_focus_sessions,
            &recent_interrupted_sessions,
            now,
        ),
    )
    .await?;

    parse_ai_review_summary(&content)
}

pub async fn generate_todo_activation_relief(
    app: &AppHandle,
    request: TodoActivationReliefRequest,
) -> AppResult<TodoActivationRelief> {
    let snapshot = db::load_snapshot(app)?;
    validate_ai_settings(&snapshot.settings)?;

    let todo = snapshot
        .todos
        .iter()
        .find(|item| item.id == request.todo_id)
        .cloned()
        .ok_or_else(|| "Todo not found.".to_string())?;

    if !matches!(todo.status.as_str(), "todo" | "in_progress") {
        return Err("Only todo or in-progress items can use AI relief.".to_string());
    }

    let project = snapshot
        .projects
        .iter()
        .find(|item| item.id == todo.project_id)
        .cloned()
        .ok_or_else(|| "Project not found.".to_string())?;

    if project.status == "archived" {
        return Err("Archived projects cannot use AI relief.".to_string());
    }

    if matches!(request.mode.as_str(), "need_smaller" | "need_alternative")
        && request.previous_relief.is_none()
    {
        return Err("Refining AI relief requires a previous suggestion.".to_string());
    }

    if let Some(previous_relief) = request.previous_relief.as_ref() {
        if previous_relief.todo_id != todo.id {
            return Err("The previous AI relief does not match the current todo.".to_string());
        }
    }

    let content = request_chat_completion(
        &snapshot.settings,
        ACTIVATION_RELIEF_SYSTEM_PROMPT,
        build_activation_relief_user_prompt(&project.name, &todo, &request),
    )
    .await?;

    parse_todo_activation_relief(&todo, &content)
}

pub async fn generate_focus_continuation(
    app: &AppHandle,
    feedback: FocusFeedbackDraft,
) -> AppResult<FocusContinuationSuggestion> {
    let snapshot = db::load_snapshot(app)?;
    validate_ai_settings(&snapshot.settings)?;

    let project = snapshot
        .projects
        .iter()
        .find(|item| item.id == feedback.project_id)
        .cloned()
        .ok_or_else(|| "Project not found.".to_string())?;
    let todo = snapshot
        .todos
        .iter()
        .find(|item| item.id == feedback.todo_id && item.project_id == feedback.project_id)
        .cloned()
        .ok_or_else(|| "Todo not found.".to_string())?;

    if project.status == "archived" {
        return Err("Archived projects cannot use AI continuation.".to_string());
    }

    let saved_feedback = db::save_focus_feedback_log(app, feedback)?;
    let feedback_history = db::load_recent_focus_feedback_logs(
        app,
        &project.id,
        FOCUS_CONTINUATION_HISTORY_LIMIT,
    )?;
    let recent_focus_sessions = snapshot
        .sessions
        .iter()
        .filter(|session| {
            session.r#type == "focus"
                && session.project_id == project.id
                && matches!(session.result.as_str(), "completed" | "interrupted")
        })
        .take(12)
        .cloned()
        .collect::<Vec<_>>();

    let content = request_chat_completion(
        &snapshot.settings,
        FOCUS_CONTINUATION_SYSTEM_PROMPT,
        build_focus_continuation_user_prompt(
            &project.name,
            &todo,
            &saved_feedback,
            &feedback_history,
            &recent_focus_sessions,
        ),
    )
    .await?;

    parse_focus_continuation_suggestion(&content)
}

fn validate_ai_settings(settings: &AppSettings) -> AppResult<()> {
    if settings.ai_base_url.trim().is_empty()
        || settings.ai_api_key.trim().is_empty()
        || settings.ai_model_id.trim().is_empty()
    {
        return Err(
            "AI settings are incomplete. Please configure base URL, API key, and model ID."
                .to_string(),
        );
    }

    Ok(())
}

async fn request_chat_completion(
    settings: &AppSettings,
    system_prompt: &str,
    user_prompt: String,
) -> AppResult<String> {
    let endpoint = build_chat_completions_url(&settings.ai_base_url);
    let request_body = json!({
        "model": settings.ai_model_id.trim(),
        "temperature": 0.3,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_prompt,
            }
        ]
    });

    let client = Client::builder()
        .timeout(Duration::from_secs(AI_TIMEOUT_SECONDS))
        .build()
        .map_err(to_string)?;

    let response = client
        .post(endpoint)
        .bearer_auth(settings.ai_api_key.trim())
        .json(&request_body)
        .send()
        .await
        .map_err(to_string)?;

    let status = response.status();
    let response_text = response.text().await.map_err(to_string)?;

    if !status.is_success() {
        return Err(format!(
            "AI request failed with status {}: {}",
            status,
            truncate(&response_text, 240)
        ));
    }

    let completion: ChatCompletionResponse =
        serde_json::from_str(&response_text).map_err(|error| format!("Invalid AI response: {error}"))?;
    extract_message_content(&completion)
}

fn build_todo_user_prompt(project_name: &str, todos: &[Todo]) -> String {
    let todo_payload = todos
        .iter()
        .map(|todo| {
            json!({
                "id": todo.id,
                "title": todo.title,
                "quickStartStep": todo.quick_start_step,
                "description": todo.description,
            })
        })
        .collect::<Vec<_>>();

    format!(
        "Project: {project_name}\n\
Rewrite every todo description so it includes:\n\
1. quickStartStep: a single minimal action that gets the user started immediately\n\
2. updatedDescription: follow-up steps only, without repeating quickStartStep\n\
Rules:\n\
- Stay on the same action thread as the todo title.\n\
- Do not swap the main task for generic setup like reading docs or browsing an overview page, unless the todo is explicitly about reading or research.\n\
- If the todo mentions AI, assistant, model, prompt, chat, or AI-generated output, quickStartStep must directly use that AI workflow in the very first step.\n\
- updatedDescription must continue from quickStartStep instead of jumping to a different phase.\n\
Example:\n\
- Todo title: \"docker-compose 让AI辅助学习概念并生成练习进行巩固\"\n\
- Good quickStartStep: \"打开 AI 对话框，输入：请用初学者视角解释 docker-compose 的服务、网络、卷，并给我 3 道练习题。\"\n\
- Bad quickStartStep: \"打开 docker-compose 官方文档，阅读 Overview 部分\"\n\
Keep the writing concise and actionable.\n\
Return JSON only.\n\
Input todos:\n{}",
        serde_json::to_string_pretty(&todo_payload).unwrap_or_else(|_| "[]".to_string())
    )
}

fn build_activation_relief_user_prompt(
    project_name: &str,
    todo: &Todo,
    request: &TodoActivationReliefRequest,
) -> String {
    let todo_payload = json!({
        "id": todo.id,
        "title": todo.title,
        "quickStartStep": todo.quick_start_step,
        "description": todo.description,
        "notes": todo.notes,
    });
    let previous_relief_payload = request.previous_relief.as_ref().map(|relief| {
        json!({
            "quickStartStep": relief.quick_start_step,
            "updatedDescription": relief.updated_description,
            "fallbackStep": relief.fallback_step,
        })
    });
    let block_reason = match request.block_reason.as_str() {
        "unclear_start" => "用户不知道从哪一步开始，需要一个立刻可执行的起点。",
        "task_too_big" => "用户觉得任务太大，需要把动作压缩到更小、更容易下手。",
        "details_too_fuzzy" => "用户觉得细节模糊，需要更具体、可验证的动作。",
        "context_switch" => "用户刚被打断或刚切回来，需要一个能快速重新进入上下文的动作。",
        _ => "用户暂时卡住了，需要一个更容易开始的动作。",
    };
    let mode_instruction = match request.mode.as_str() {
        "need_smaller" => "请在上一版建议基础上继续缩小动作颗粒度，让第一步更轻、更快开始。",
        "need_alternative" => "上一版建议没有帮助，请换一个思路，不要只是改写同一句话。",
        _ => "请先给出一版适合当前卡点的起步建议。",
    };

    format!(
        "Project: {project_name}\n\
Help the user start this one todo right now.\n\
Return JSON only.\n\
Blocker reason: {block_reason}\n\
Refinement mode: {mode}\n\
Mode instruction: {mode_instruction}\n\
quickStartStep must be the smallest concrete action they can do immediately.\n\
updatedDescription must contain 2 to 4 follow-up actions that naturally continue after quickStartStep succeeds.\n\
The first follow-up action must stay on the same immediate thread and must not jump to a later deliverable or a different phase.\n\
If quickStartStep is about reading context, understanding a concept, or reopening materials, updatedDescription must continue from that same thread.\n\
fallbackStep must be a backup action if they still cannot start after trying once.\n\
Do not repeat the original text unless it is already the best wording.\n\
Input todo:\n{}\n\
Previous AI relief:\n{}",
        serde_json::to_string_pretty(&todo_payload).unwrap_or_else(|_| "{}".to_string()),
        serde_json::to_string_pretty(&previous_relief_payload.unwrap_or_else(|| json!(null)))
            .unwrap_or_else(|_| "null".to_string()),
        mode = request.mode,
    )
}

fn build_focus_continuation_user_prompt(
    project_name: &str,
    todo: &Todo,
    current_feedback: &FocusFeedbackLog,
    feedback_history: &[FocusFeedbackLog],
    sessions: &[FocusSession],
) -> String {
    let recent_feedback_payload = feedback_history
        .iter()
        .take(FOCUS_CONTINUATION_HISTORY_LIMIT as usize)
        .map(|item| {
            json!({
                "createdAt": item.created_at,
                "completed": item.completed_text,
                "issues": item.issue_text,
                "risk": item.risk_text,
            })
        })
        .collect::<Vec<_>>();
    let session_payload = sessions
        .iter()
        .take(8)
        .map(|session| {
            json!({
                "startedAt": session.started_at,
                "result": session.result,
                "actualDurationSec": session.actual_duration_sec,
                "interruptReason": session.interrupt_reason,
            })
        })
        .collect::<Vec<_>>();
    let todo_payload = json!({
        "title": todo.title,
        "quickStartStep": todo.quick_start_step,
        "description": todo.description,
        "status": todo.status,
        "priority": todo.priority,
        "estimatedPomodoros": todo.estimated_pomodoros,
        "completedPomodoros": todo.completed_pomodoros,
    });
    let current_feedback_payload = json!({
        "completed": current_feedback.completed_text,
        "issues": current_feedback.issue_text,
        "risk": current_feedback.risk_text,
        "createdAt": current_feedback.created_at,
    });

    format!(
        "Project: {project_name}\n\
Current todo context:\n{}\n\
Current pomodoro feedback:\n{}\n\
Recent feedback history (latest first):\n{}\n\
Recent focus sessions:\n{}\n\
Generate continuation advice in Simplified Chinese and keep wording concrete.\n\
Return JSON only.",
        serde_json::to_string_pretty(&todo_payload).unwrap_or_else(|_| "{}".to_string()),
        serde_json::to_string_pretty(&current_feedback_payload).unwrap_or_else(|_| "{}".to_string()),
        serde_json::to_string_pretty(&recent_feedback_payload).unwrap_or_else(|_| "[]".to_string()),
        serde_json::to_string_pretty(&session_payload).unwrap_or_else(|_| "[]".to_string()),
    )
}

fn build_review_user_prompt(
    scoped_project: Option<&Project>,
    projects: &[Project],
    todos: &[Todo],
    recent_focus_sessions: &[FocusSession],
    recent_interrupted_sessions: &[FocusSession],
    now: DateTime<Utc>,
) -> String {
    let project_ids = todos
        .iter()
        .map(|todo| todo.project_id.clone())
        .collect::<HashSet<_>>();
    let relevant_projects = projects
        .iter()
        .filter(|project| project_ids.contains(&project.id))
        .collect::<Vec<_>>();

    let total_focus_duration_sec = recent_focus_sessions
        .iter()
        .map(|session| session.actual_duration_sec)
        .sum::<i64>();
    let done_todos = todos.iter().filter(|todo| todo.status == "done").count();
    let open_todos = todos
        .iter()
        .filter(|todo| matches!(todo.status.as_str(), "todo" | "in_progress"))
        .count();
    let estimated_pomodoros = todos.iter().map(|todo| todo.estimated_pomodoros).sum::<i64>();
    let completed_pomodoros = recent_focus_sessions.len() as i64;
    let high_priority_total = todos.iter().filter(|todo| todo.priority == "high").count();
    let high_priority_done = todos
        .iter()
        .filter(|todo| todo.priority == "high" && todo.status == "done")
        .count();

    let daily_trend = build_daily_trend(recent_focus_sessions, now);
    let project_summaries = relevant_projects
        .iter()
        .map(|project| {
            let project_todos = todos
                .iter()
                .filter(|todo| todo.project_id == project.id)
                .collect::<Vec<_>>();
            let focus_count = recent_focus_sessions
                .iter()
                .filter(|session| session.project_id == project.id)
                .count();
            let interrupted_count = recent_interrupted_sessions
                .iter()
                .filter(|session| session.project_id == project.id)
                .count();
            json!({
                "projectName": project.name,
                "focusCount": focus_count,
                "interruptedCount": interrupted_count,
                "doneTodos": project_todos.iter().filter(|todo| todo.status == "done").count(),
                "openTodos": project_todos.iter().filter(|todo| matches!(todo.status.as_str(), "todo" | "in_progress")).count(),
            })
        })
        .collect::<Vec<_>>();

    let representative_todos = build_representative_todos(todos);
    let payload = json!({
        "scope": {
            "type": if scoped_project.is_some() { "project" } else { "all" },
            "projectName": scoped_project.map(|project| project.name.clone()),
            "timeframe": "last_7_days",
        },
        "metrics": {
            "focusCount": recent_focus_sessions.len(),
            "focusDurationSec": total_focus_duration_sec,
            "interruptedCount": recent_interrupted_sessions.len(),
            "doneTodos": done_todos,
            "openTodos": open_todos,
            "estimatedPomodoros": estimated_pomodoros,
            "completedPomodoros": completed_pomodoros,
            "highPriorityTotal": high_priority_total,
            "highPriorityDone": high_priority_done,
        },
        "dailyTrend": daily_trend,
        "projects": project_summaries,
        "representativeTodos": representative_todos,
    });

    format!(
        "Write a weekly pomodoro review in Simplified Chinese for the following dataset.\n\
Use only the provided evidence.\n\
Return JSON only.\n\
Input:\n{}",
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string())
    )
}

fn build_daily_trend(recent_focus_sessions: &[FocusSession], now: DateTime<Utc>) -> Vec<Value> {
    let mut buckets = BTreeMap::new();
    for offset in (0..AI_REVIEW_WINDOW_DAYS).rev() {
        let key = (now - ChronoDuration::days(offset))
            .format("%Y-%m-%d")
            .to_string();
        buckets.insert(key, (0_i64, 0_i64));
    }

    for session in recent_focus_sessions {
        if let Some(started_at) = parse_rfc3339_to_utc(&session.started_at) {
            let key = started_at.format("%Y-%m-%d").to_string();
            if let Some((count, duration)) = buckets.get_mut(&key) {
                *count += 1;
                *duration += session.actual_duration_sec;
            }
        }
    }

    buckets
        .into_iter()
        .map(|(date, (focus_count, focus_duration_sec))| {
            json!({
                "date": date,
                "focusCount": focus_count,
                "focusDurationSec": focus_duration_sec,
            })
        })
        .collect()
}

fn build_representative_todos(todos: &[Todo]) -> Vec<Value> {
    let mut ordered = todos.to_vec();
    ordered.sort_by(|left, right| {
        todo_status_weight(&left.status)
            .cmp(&todo_status_weight(&right.status))
            .then_with(|| priority_weight(&left.priority).cmp(&priority_weight(&right.priority)))
            .then_with(|| {
                let left_gap = (left.completed_pomodoros - left.estimated_pomodoros).abs();
                let right_gap = (right.completed_pomodoros - right.estimated_pomodoros).abs();
                right_gap.cmp(&left_gap)
            })
            .then_with(|| left.title.cmp(&right.title))
    });

    ordered
        .into_iter()
        .take(6)
        .map(|todo| {
            json!({
                "title": todo.title,
                "status": todo.status,
                "priority": todo.priority,
                "estimatedPomodoros": todo.estimated_pomodoros,
                "completedPomodoros": todo.completed_pomodoros,
                "quickStartStep": todo.quick_start_step,
            })
        })
        .collect()
}

fn priority_weight(priority: &str) -> i32 {
    match priority {
        "high" => 0,
        "medium" => 1,
        "low" => 2,
        _ => 3,
    }
}

fn todo_status_weight(status: &str) -> i32 {
    match status {
        "in_progress" => 0,
        "todo" => 1,
        "done" => 2,
        "cancelled" => 3,
        _ => 4,
    }
}

fn is_recent_session(
    session: &FocusSession,
    project_id: Option<&str>,
    window_start: &DateTime<Utc>,
    expected_type: &str,
    expected_result: &str,
) -> bool {
    if session.r#type != expected_type || session.result != expected_result {
        return false;
    }
    if let Some(id) = project_id {
        if session.project_id != id {
            return false;
        }
    }

    parse_rfc3339_to_utc(&session.started_at)
        .map(|started_at| started_at >= *window_start)
        .unwrap_or(false)
}

fn parse_rfc3339_to_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date_time| date_time.with_timezone(&Utc))
}

fn build_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn extract_message_content(response: &ChatCompletionResponse) -> AppResult<String> {
    let content = response
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_ref())
        .ok_or_else(|| "AI response did not contain any message content.".to_string())?;

    match content {
        Value::String(text) => Ok(text.clone()),
        Value::Array(parts) => Ok(parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<String>()),
        other => Err(format!("Unsupported AI content format: {other}")),
    }
}

fn parse_todo_suggestions(content: &str) -> AppResult<Vec<RawTodoAiSuggestion>> {
    let cleaned = strip_code_fences(content.trim());

    if let Ok(items) = serde_json::from_str::<Vec<RawTodoAiSuggestion>>(cleaned) {
        return Ok(items);
    }

    if let Ok(wrapper) = serde_json::from_str::<RawTodoAiSuggestionEnvelope>(cleaned) {
        return Ok(wrapper.items);
    }

    let json_segment = extract_json_segment(cleaned)?;
    if let Ok(items) = serde_json::from_str::<Vec<RawTodoAiSuggestion>>(&json_segment) {
        return Ok(items);
    }
    if let Ok(wrapper) = serde_json::from_str::<RawTodoAiSuggestionEnvelope>(&json_segment) {
        return Ok(wrapper.items);
    }

    Err("AI response could not be parsed into todo suggestions.".to_string())
}

fn parse_todo_activation_relief(todo: &Todo, content: &str) -> AppResult<TodoActivationRelief> {
    let cleaned = strip_code_fences(content.trim());
    if let Ok(raw) = serde_json::from_str::<RawTodoActivationRelief>(cleaned) {
        return validate_todo_activation_relief(todo, raw);
    }

    let json_segment = extract_json_segment(cleaned)?;
    let raw = serde_json::from_str::<RawTodoActivationRelief>(&json_segment)
        .map_err(|_| "AI response could not be parsed into activation relief.".to_string())?;
    validate_todo_activation_relief(todo, raw)
}

fn parse_focus_continuation_suggestion(content: &str) -> AppResult<FocusContinuationSuggestion> {
    let cleaned = strip_code_fences(content.trim());
    if let Ok(raw) = serde_json::from_str::<RawFocusContinuationSuggestion>(cleaned) {
        return validate_focus_continuation_suggestion(raw);
    }

    let json_segment = extract_json_segment(cleaned)?;
    let raw = serde_json::from_str::<RawFocusContinuationSuggestion>(&json_segment)
        .map_err(|_| "AI response could not be parsed into continuation suggestion.".to_string())?;
    validate_focus_continuation_suggestion(raw)
}

fn validate_todo_suggestions(
    todos: Vec<Todo>,
    raw_suggestions: Vec<RawTodoAiSuggestion>,
) -> AppResult<Vec<TodoAiSuggestion>> {
    if raw_suggestions.len() != todos.len() {
        return Err(format!(
            "AI returned {} suggestions, but {} todos were requested.",
            raw_suggestions.len(),
            todos.len()
        ));
    }

    let mut raw_map = HashMap::new();
    for suggestion in raw_suggestions {
        let updated_description = suggestion.updated_description.trim().to_string();
        let quick_start_step = suggestion.quick_start_step.trim().to_string();
        if quick_start_step.is_empty() {
            return Err(format!(
                "AI returned an empty quick start step for todo {}.",
                suggestion.todo_id
            ));
        }
        if updated_description.is_empty() {
            return Err(format!(
                "AI returned an empty description for todo {}.",
                suggestion.todo_id
            ));
        }
        if raw_map
            .insert(suggestion.todo_id.clone(), (quick_start_step, updated_description))
            .is_some()
        {
            return Err(format!(
                "AI returned duplicate suggestions for todo {}.",
                suggestion.todo_id
            ));
        }
    }

    todos.into_iter()
        .map(|todo| {
            let (updated_quick_start_step, updated_description) = raw_map
                .remove(&todo.id)
                .ok_or_else(|| format!("AI missed todo {}.", todo.id))?;
            if todo_requires_ai_direct_action(&todo)
                && !quick_start_step_uses_ai_channel(&updated_quick_start_step)
            {
                return Err(format!(
                    "AI quick start drifted away from the AI-assisted intent for todo {}.",
                    todo.id
                ));
            }

            Ok(TodoAiSuggestion {
                todo_id: todo.id,
                title: todo.title,
                original_quick_start_step: todo.quick_start_step,
                updated_quick_start_step,
                original_description: todo.description,
                updated_description,
            })
        })
        .collect()
}

fn todo_requires_ai_direct_action(todo: &Todo) -> bool {
    let context = format!("{} {} {}", todo.title, todo.description, todo.notes);
    contains_any_keyword(
        &context,
        &[
            "ai",
            "assistant",
            "gpt",
            "llm",
            "chatgpt",
            "claude",
            "cursor",
            "copilot",
            "deepseek",
            "kimi",
            "prompt",
            "提示词",
            "模型",
            "大模型",
            "智能体",
            "助手",
            "辅助",
        ],
    )
}

fn quick_start_step_uses_ai_channel(step: &str) -> bool {
    contains_any_keyword(
        step,
        &[
            "ai",
            "assistant",
            "gpt",
            "llm",
            "chatgpt",
            "claude",
            "cursor",
            "copilot",
            "deepseek",
            "kimi",
            "prompt",
            "提示词",
            "模型",
            "大模型",
            "智能体",
            "助手",
            "对话",
            "聊天",
            "提问",
        ],
    )
}

fn contains_any_keyword(text: &str, keywords: &[&str]) -> bool {
    let lower = text.to_lowercase();
    keywords.iter().any(|keyword| lower.contains(keyword))
}

fn validate_todo_activation_relief(
    todo: &Todo,
    raw: RawTodoActivationRelief,
) -> AppResult<TodoActivationRelief> {
    let quick_start_step = raw.quick_start_step.trim().to_string();
    let updated_description = raw.updated_description.trim().to_string();
    let fallback_step = raw.fallback_step.trim().to_string();

    if quick_start_step.is_empty() || updated_description.is_empty() || fallback_step.is_empty() {
        return Err("AI relief response was incomplete.".to_string());
    }

    Ok(TodoActivationRelief {
        todo_id: todo.id.clone(),
        title: todo.title.clone(),
        quick_start_step,
        updated_description,
        fallback_step,
    })
}

fn validate_focus_continuation_suggestion(
    raw: RawFocusContinuationSuggestion,
) -> AppResult<FocusContinuationSuggestion> {
    let quick_start_step = raw.quick_start_step.trim().to_string();
    let fallback_step = raw.fallback_step.trim().to_string();
    let next_steps = raw
        .next_steps
        .into_iter()
        .map(|step| step.trim().to_string())
        .filter(|step| !step.is_empty())
        .take(4)
        .collect::<Vec<_>>();

    if quick_start_step.is_empty() || fallback_step.is_empty() || next_steps.len() < 2 {
        return Err("AI continuation response was incomplete.".to_string());
    }

    Ok(FocusContinuationSuggestion {
        quick_start_step,
        next_steps,
        fallback_step,
    })
}

fn parse_ai_review_summary(content: &str) -> AppResult<AiReviewSummary> {
    let cleaned = strip_code_fences(content.trim());
    if let Ok(raw) = serde_json::from_str::<RawAiReviewSummary>(cleaned) {
        return validate_ai_review_summary(raw);
    }

    let json_segment = extract_json_segment(cleaned)?;
    let raw = serde_json::from_str::<RawAiReviewSummary>(&json_segment)
        .map_err(|_| "AI response could not be parsed into a review summary.".to_string())?;
    validate_ai_review_summary(raw)
}

fn validate_ai_review_summary(raw: RawAiReviewSummary) -> AppResult<AiReviewSummary> {
    let summary = normalize_review_lines(raw.summary);
    let issues = normalize_review_lines(raw.issues);
    let suggestions = normalize_review_lines(raw.suggestions);

    if summary.is_empty() || issues.is_empty() || suggestions.is_empty() {
        return Err("AI review response was incomplete.".to_string());
    }

    Ok(AiReviewSummary {
        summary,
        issues,
        suggestions,
    })
}

fn normalize_review_lines(items: Vec<String>) -> Vec<String> {
    items.into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .take(4)
        .collect()
}

fn strip_code_fences(content: &str) -> &str {
    content
        .strip_prefix("```json")
        .or_else(|| content.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(content)
}

fn extract_json_segment(content: &str) -> AppResult<String> {
    let bytes = content.as_bytes();
    let start = bytes
        .iter()
        .position(|byte| *byte == b'[' || *byte == b'{')
        .ok_or_else(|| "AI response did not contain JSON.".to_string())?;

    let opening = bytes[start];
    let closing = if opening == b'[' { b']' } else { b'}' };
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;

    for (index, byte) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if *byte == b'\\' {
                escaped = true;
                continue;
            }
            if *byte == b'"' {
                in_string = false;
            }
            continue;
        }

        if *byte == b'"' {
            in_string = true;
            continue;
        }

        if *byte == opening {
            depth += 1;
        } else if *byte == closing {
            depth -= 1;
            if depth == 0 {
                return Ok(content[start..=index].to_string());
            }
        }
    }

    Err("AI response contained incomplete JSON.".to_string())
}

fn truncate(value: &str, max_len: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_len).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        build_activation_relief_user_prompt, build_chat_completions_url, extract_json_segment,
        parse_ai_review_summary, parse_focus_continuation_suggestion, parse_todo_activation_relief,
        parse_todo_suggestions, quick_start_step_uses_ai_channel, todo_requires_ai_direct_action,
        validate_todo_suggestions, RawTodoAiSuggestion,
    };
    use crate::models::{Todo, TodoActivationRelief, TodoActivationReliefRequest};

    fn sample_todo(id: &str) -> Todo {
        Todo {
            id: id.to_string(),
            project_id: "project-1".to_string(),
            title: format!("Todo {id}"),
            quick_start_step: "Current quick start".to_string(),
            description: "Current description".to_string(),
            notes: String::new(),
            status: "todo".to_string(),
            priority: "medium".to_string(),
            estimated_pomodoros: 1,
            completed_pomodoros: 0,
            due_date: None,
            is_today: false,
            steps: vec!["Current description".to_string()],
            current_step_index: 0,
            created_at: "2026-04-02T00:00:00.000Z".to_string(),
            completed_at: None,
        }
    }

    #[test]
    fn build_chat_completions_url_accepts_root_or_full_endpoint() {
        assert_eq!(
            build_chat_completions_url("https://api.example.com/v1"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            build_chat_completions_url("https://api.example.com/chat/completions"),
            "https://api.example.com/chat/completions"
        );
    }

    #[test]
    fn extract_json_segment_pulls_wrapped_json() {
        let json = extract_json_segment(
            "Here is the result:\n[{\"todoId\":\"todo-1\",\"quickStartStep\":\"Open the file\",\"updatedDescription\":\"List the remaining steps\"}]",
        )
        .expect("json should be extracted");

        assert_eq!(
            json,
            "[{\"todoId\":\"todo-1\",\"quickStartStep\":\"Open the file\",\"updatedDescription\":\"List the remaining steps\"}]"
        );
    }

    #[test]
    fn parse_todo_suggestions_accepts_code_fenced_payloads() {
        let suggestions = parse_todo_suggestions(
            "```json\n[{\"todoId\":\"todo-1\",\"quickStartStep\":\"Open the file\",\"updatedDescription\":\"List the remaining steps\"}]\n```",
        )
        .expect("suggestions should parse");

        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].todo_id, "todo-1");
    }

    #[test]
    fn validate_todo_suggestions_rejects_missing_items() {
        let error = validate_todo_suggestions(
            vec![sample_todo("todo-1"), sample_todo("todo-2")],
            vec![RawTodoAiSuggestion {
                todo_id: "todo-1".to_string(),
                quick_start_step: "Start here".to_string(),
                updated_description: "Start here".to_string(),
            }],
        )
        .expect_err("missing suggestion should fail");

        assert!(error.contains("AI returned 1 suggestions"));
    }

    #[test]
    fn validate_todo_suggestions_rejects_ai_todo_that_starts_with_doc_reading() {
        let todo = Todo {
            title: "docker-compose 让AI辅助学习概念并生成练习进行巩固".to_string(),
            description: "用 AI 帮我解释概念并给练习".to_string(),
            notes: String::new(),
            ..sample_todo("todo-ai")
        };

        let error = validate_todo_suggestions(
            vec![todo],
            vec![RawTodoAiSuggestion {
                todo_id: "todo-ai".to_string(),
                quick_start_step: "打开 docker-compose 官方文档，阅读 Overview 部分".to_string(),
                updated_description: "1. 记下核心概念。".to_string(),
            }],
        )
        .expect_err("doc-reading detour should fail");

        assert!(error.contains("AI quick start drifted away"));
    }

    #[test]
    fn validate_todo_suggestions_accepts_ai_todo_that_directly_uses_ai() {
        let todo = Todo {
            title: "docker-compose 让AI辅助学习概念并生成练习进行巩固".to_string(),
            description: "用 AI 帮我解释概念并给练习".to_string(),
            notes: String::new(),
            ..sample_todo("todo-ai")
        };

        let suggestions = validate_todo_suggestions(
            vec![todo],
            vec![RawTodoAiSuggestion {
                todo_id: "todo-ai".to_string(),
                quick_start_step:
                    "打开 AI 对话框，输入：请解释 docker-compose 的服务、网络、卷，并给我 3 道练习题。"
                        .to_string(),
                updated_description: "1. 先做第 1 道练习。".to_string(),
            }],
        )
        .expect("ai-aligned suggestion should pass");

        assert_eq!(suggestions.len(), 1);
    }

    #[test]
    fn ai_intent_helpers_detect_ai_tasks_and_steps() {
        let todo = Todo {
            title: "让 AI 帮我写一个练习清单".to_string(),
            description: "用 AI 快速出题".to_string(),
            notes: String::new(),
            ..sample_todo("todo-ai")
        };

        assert!(todo_requires_ai_direct_action(&todo));
        assert!(quick_start_step_uses_ai_channel("打开 Cursor 聊天，直接提问并生成练习"));
        assert!(!quick_start_step_uses_ai_channel("打开官方文档先阅读概览"));
    }

    #[test]
    fn parse_ai_review_summary_accepts_wrapped_json() {
        let summary = parse_ai_review_summary(
            "```json\n{\"summary\":[\"本周完成 5 次专注\"],\"issues\":[\"高优任务推进偏慢\"],\"suggestions\":[\"先拆小再开始\"]}\n```",
        )
        .expect("review summary should parse");

        assert_eq!(summary.summary, vec!["本周完成 5 次专注"]);
        assert_eq!(summary.issues, vec!["高优任务推进偏慢"]);
        assert_eq!(summary.suggestions, vec!["先拆小再开始"]);
    }

    #[test]
    fn parse_todo_activation_relief_rejects_legacy_payload_without_updated_description() {
        let error = parse_todo_activation_relief(
            &sample_todo("todo-1"),
            "```json\n{\"quickStartStep\":\"先打开当前任务文档。\",\"fallbackStep\":\"如果还是卡住，就只列出 3 个子项。\"}\n```",
        )
        .expect_err("legacy payload should fail");

        assert_eq!(
            error,
            "AI response could not be parsed into activation relief.".to_string()
        );
    }

    #[test]
    fn parse_todo_activation_relief_accepts_updated_description() {
        let relief = parse_todo_activation_relief(
            &sample_todo("todo-1"),
            "```json\n{\"quickStartStep\":\"先打开当前任务文档。\",\"updatedDescription\":\"1. 先列出当前要处理的 3 个子项。\\n2. 再只完成第 1 个子项。\",\"fallbackStep\":\"如果还是卡住，就只列出 3 个子项。\"}\n```",
        )
        .expect("activation relief should parse");

        assert_eq!(relief.todo_id, "todo-1");
        assert_eq!(relief.quick_start_step, "先打开当前任务文档。");
        assert_eq!(
            relief.updated_description,
            "1. 先列出当前要处理的 3 个子项。\n2. 再只完成第 1 个子项。"
        );
        assert_eq!(relief.fallback_step, "如果还是卡住，就只列出 3 个子项。");
    }

    #[test]
    fn build_activation_relief_user_prompt_includes_blocker_and_previous_relief() {
        let prompt = build_activation_relief_user_prompt(
            "项目 A",
            &sample_todo("todo-1"),
            &TodoActivationReliefRequest {
                todo_id: "todo-1".to_string(),
                block_reason: "task_too_big".to_string(),
                mode: "need_smaller".to_string(),
                previous_relief: Some(TodoActivationRelief {
                    todo_id: "todo-1".to_string(),
                    title: "Todo todo-1".to_string(),
                    quick_start_step: "先打开文档".to_string(),
                    updated_description: "1. 先看当前章节标题。\n2. 再补一行摘要。".to_string(),
                    fallback_step: "如果还是卡住，就只写标题".to_string(),
                }),
            },
        );

        assert!(prompt.contains("任务太大"));
        assert!(prompt.contains("need_smaller"));
        assert!(prompt.contains("先打开文档"));
        assert!(prompt.contains("updatedDescription"));
    }

    #[test]
    fn parse_focus_continuation_suggestion_accepts_wrapped_json() {
        let suggestion = parse_focus_continuation_suggestion(
            "```json\n{\"quickStartStep\":\"先打开任务文件并写下目标。\",\"nextSteps\":[\"补齐第一个子任务\",\"完成关键验证\"],\"fallbackStep\":\"如果还卡住，先写一个最小草稿。\"}\n```",
        )
        .expect("continuation suggestion should parse");

        assert_eq!(suggestion.quick_start_step, "先打开任务文件并写下目标。");
        assert_eq!(suggestion.next_steps, vec!["补齐第一个子任务", "完成关键验证"]);
        assert_eq!(suggestion.fallback_step, "如果还卡住，先写一个最小草稿。");
    }
}
