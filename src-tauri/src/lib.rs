mod ai;
mod db;
mod models;

use ai::{
    generate_ai_review as generate_ai_review_service,
    generate_focus_continuation as generate_focus_continuation_service,
    generate_todo_activation_relief as generate_todo_activation_relief_service,
    generate_todo_ai_suggestions as generate_todo_ai_suggestions_service,
};
use db::{
    archive_project as archive_project_db, clear_all_data as clear_all_data_db, delete_project as delete_project_db,
    delete_todo as delete_todo_db, init_database, load_ai_reviews as load_ai_reviews_db, load_settings,
    load_snapshot as load_snapshot_db, record_focus_session as record_focus_session_db,
    save_ai_review as save_ai_review_db, save_project as save_project_db, save_settings as save_settings_db,
    save_todo as save_todo_db, should_minimize_to_tray,
};
use models::{
    AiReviewRecord, AiReviewRecordDraft, AiReviewSummary, AppSnapshot,
    FocusContinuationSuggestion, FocusFeedbackDraft, FocusSessionDraft, ProjectDraft,
    SaveAppSettingsInput, TodoActivationRelief, TodoActivationReliefRequest, TodoAiSuggestion,
    TodoDraft,
};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_notification::NotificationExt;

type AppResult<T> = Result<T, String>;

const TRAY_ID: &str = "focus-tray";
const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
fn load_snapshot(app: AppHandle) -> AppResult<AppSnapshot> {
    load_snapshot_db(&app)
}

#[tauri::command]
fn save_project(app: AppHandle, project: ProjectDraft) -> AppResult<AppSnapshot> {
    save_project_db(&app, project)
}

#[tauri::command]
fn archive_project(app: AppHandle, project_id: String, archived: bool) -> AppResult<AppSnapshot> {
    archive_project_db(&app, &project_id, archived)
}

#[tauri::command]
fn delete_project(app: AppHandle, project_id: String) -> AppResult<AppSnapshot> {
    delete_project_db(&app, &project_id)
}

#[tauri::command]
fn save_todo(app: AppHandle, todo: TodoDraft) -> AppResult<AppSnapshot> {
    save_todo_db(&app, todo)
}

#[tauri::command]
fn delete_todo(app: AppHandle, todo_id: String) -> AppResult<AppSnapshot> {
    delete_todo_db(&app, &todo_id)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: SaveAppSettingsInput) -> AppResult<AppSnapshot> {
    let snapshot = save_settings_db(&app, settings)?;
    sync_autostart(&app)?;
    Ok(snapshot)
}

#[tauri::command]
fn clear_all_data(app: AppHandle) -> AppResult<AppSnapshot> {
    let snapshot = clear_all_data_db(&app)?;
    sync_autostart(&app)?;
    Ok(snapshot)
}

#[tauri::command]
fn record_focus_session(app: AppHandle, session: FocusSessionDraft) -> AppResult<AppSnapshot> {
    record_focus_session_db(&app, session)
}

#[tauri::command]
fn notify_phase(app: AppHandle, title: String, body: String) -> AppResult<()> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(to_string)
}

#[tauri::command]
fn update_tray_status(app: AppHandle, status: String) -> AppResult<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(status)).map_err(to_string)?;
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> AppResult<()> {
    reveal_main_window(&app)
}

#[tauri::command]
async fn generate_todo_ai_suggestions(
    app: AppHandle,
    project_id: String,
    todo_ids: Vec<String>,
) -> AppResult<Vec<TodoAiSuggestion>> {
    generate_todo_ai_suggestions_service(&app, &project_id, &todo_ids).await
}

#[tauri::command]
async fn generate_todo_activation_relief(
    app: AppHandle,
    request: TodoActivationReliefRequest,
) -> AppResult<TodoActivationRelief> {
    generate_todo_activation_relief_service(&app, request).await
}

#[tauri::command]
async fn generate_focus_continuation(
    app: AppHandle,
    feedback: FocusFeedbackDraft,
) -> AppResult<FocusContinuationSuggestion> {
    generate_focus_continuation_service(&app, feedback).await
}

#[tauri::command]
async fn generate_ai_review(
    app: AppHandle,
    project_id: Option<String>,
) -> AppResult<AiReviewSummary> {
    generate_ai_review_service(&app, project_id.as_deref()).await
}

#[tauri::command]
fn load_ai_reviews(app: AppHandle) -> AppResult<Vec<AiReviewRecord>> {
    load_ai_reviews_db(&app)
}

#[tauri::command]
fn save_ai_review(app: AppHandle, review: AiReviewRecordDraft) -> AppResult<AiReviewRecord> {
    save_ai_review_db(&app, review)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = reveal_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().app_name("Pomodoro Workbench").build())
        .plugin(tauri_plugin_notification::init())
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            save_project,
            archive_project,
            delete_project,
            save_todo,
            delete_todo,
            save_settings,
            clear_all_data,
            record_focus_session,
            notify_phase,
            update_tray_status,
            show_main_window,
            generate_todo_ai_suggestions,
            generate_todo_activation_relief,
            generate_focus_continuation,
            generate_ai_review,
            load_ai_reviews,
            save_ai_review
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            init_database(&handle)?;
            sync_autostart(&handle)?;
            create_tray(&handle)?;
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn create_tray(app: &AppHandle) -> AppResult<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "missing default window icon".to_string())?;

    let menu = MenuBuilder::new(app)
        .text("tray.open", "打开工作台")
        .text("tray.toggle", "开始 / 暂停计时")
        .text("tray.skip", "跳过休息")
        .separator()
        .text("tray.quit", "退出应用")
        .build()
        .map_err(to_string)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Pomodoro Workbench · 待机")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .build(app)
        .map_err(to_string)?;

    Ok(())
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "tray.open" => {
            let _ = reveal_main_window(app);
        }
        "tray.toggle" => {
            let _ = app.emit("tray-action", "toggle-timer");
        }
        "tray.skip" => {
            let _ = app.emit("tray-action", "skip-break");
        }
        "tray.quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

fn handle_tray_event(app: &AppHandle, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
        | TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => {
            let _ = reveal_main_window(app);
            let _ = app.emit("tray-action", "open");
        }
        _ => {}
    }
}

fn handle_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if should_minimize_to_tray(&window.app_handle()).unwrap_or(true) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

trait MainWindowOps {
    fn unminimize(&self) -> AppResult<()>;
    fn show(&self) -> AppResult<()>;
    fn set_focus(&self) -> AppResult<()>;
}

impl MainWindowOps for WebviewWindow {
    fn unminimize(&self) -> AppResult<()> {
        let _ = WebviewWindow::unminimize(self);
        Ok(())
    }

    fn show(&self) -> AppResult<()> {
        WebviewWindow::show(self).map_err(to_string)
    }

    fn set_focus(&self) -> AppResult<()> {
        WebviewWindow::set_focus(self).map_err(to_string)
    }
}

fn reveal_window(window: &impl MainWindowOps) -> AppResult<()> {
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn reveal_main_window(app: &AppHandle) -> AppResult<()> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| format!("{} window not found", MAIN_WINDOW_LABEL))?;
    reveal_window(&window)
}

fn sync_autostart(app: &AppHandle) -> AppResult<()> {
    let enabled_in_settings = load_settings(app)?.launch_on_startup;
    let current = app.autolaunch().is_enabled().map_err(to_string)?;
    if enabled_in_settings && !current {
        app.autolaunch().enable().map_err(to_string)?;
    } else if !enabled_in_settings && current {
        app.autolaunch().disable().map_err(to_string)?;
    }
    Ok(())
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::{reveal_window, AppResult, MainWindowOps};
    use std::{cell::RefCell, rc::Rc};

    #[derive(Clone, Default)]
    struct FakeWindow {
        calls: Rc<RefCell<Vec<&'static str>>>,
        fail_on: Option<&'static str>,
    }

    impl FakeWindow {
        fn with_failure(step: &'static str) -> Self {
            Self {
                calls: Rc::new(RefCell::new(Vec::new())),
                fail_on: Some(step),
            }
        }

        fn calls(&self) -> Vec<&'static str> {
            self.calls.borrow().clone()
        }

        fn record(&self, step: &'static str) -> AppResult<()> {
            self.calls.borrow_mut().push(step);
            if self.fail_on == Some(step) {
                return Err(format!("{step} failed"));
            }
            Ok(())
        }
    }

    impl MainWindowOps for FakeWindow {
        fn unminimize(&self) -> AppResult<()> {
            self.record("unminimize")
        }

        fn show(&self) -> AppResult<()> {
            self.record("show")
        }

        fn set_focus(&self) -> AppResult<()> {
            self.record("set_focus")
        }
    }

    #[test]
    fn reveal_window_unminimizes_shows_and_focuses_main_window() {
        let window = FakeWindow::default();

        reveal_window(&window).expect("window should be revealed");

        assert_eq!(window.calls(), vec!["unminimize", "show", "set_focus"]);
    }

    #[test]
    fn reveal_window_stops_when_show_fails() {
        let window = FakeWindow::with_failure("show");

        let error = reveal_window(&window).expect_err("show failure should bubble up");

        assert_eq!(error, "show failed");
        assert_eq!(window.calls(), vec!["unminimize", "show"]);
    }
}
