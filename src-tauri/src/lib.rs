use keytap::{EventKind, Tap};
#[cfg(target_os = "macos")]
use std::ffi::c_void;
#[cfg(target_os = "macos")]
use std::ptr;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::CheckMenuItem;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewWindow,
};
use tauri_nspanel::{tauri_panel, PanelLevel, StyleMask, WebviewWindowExt};

struct AppWindow(Mutex<Option<WebviewWindow>>);
struct PanelExpanded(Mutex<bool>);
struct WaterRestoreState(Mutex<Option<WindowSnapshot>>);

/// 「窗口置顶」开关状态。右键菜单与 Tray 菜单共享同一份状态。
struct AlwaysOnTop(Mutex<bool>);

/// Tray 菜单里 id="pin" 的勾选项引用，便于勾选状态同步。
struct TrayPinItem(Mutex<Option<CheckMenuItem<tauri::Wry>>>);

/// 开机自启开关状态。
struct StartupEnabled(Mutex<bool>);

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const PET_SIZE: f64 = 128.0;
// 窗口固定尺寸 260×305：启动后永不 resize/移动（避免 WKWebView 重排导致猫闪烁）。
// 宽度 = 名字输入框 258px 左右各多 1px；高度 = 金色输入框底部 290px + 15px 间距。
// 布局：顶部 0~96px 气泡区；猫固定在 96~224px（水平居中）；
// 猫下方 224~305px 为番茄钟倒计时/按钮、名字输入框区域。
const WINDOW_WIDTH: f64 = 260.0;
const WINDOW_HEIGHT: f64 = 305.0;

// macOS LaunchAgent 文件名：com.jun.desktop-pet.plist
const LAUNCH_AGENT_LABEL: &str = "com.jun.desktop-pet";
const LAUNCH_AGENT_FILENAME: &str = "com.jun.desktop-pet.plist";

#[derive(Clone, Copy)]
struct WindowSnapshot {
    // 放大前窗口左上角坐标（NSWindow frame 的 origin，点单位），恢复时平滑回到原位。
    origin_x: f64,
    origin_y: f64,
    // 放大前窗口尺寸（点单位）。可能是常态 128×128 或番茄钟扩展 128×150。
    width: f64,
    height: f64,
    // 放大前是否处于番茄钟扩展模式，恢复时还原界面状态。
    pomodoro_expanded: bool,
}

tauri_panel! {
    panel!(BasicPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct CursorPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const c_void) -> *const c_void;
    fn CGEventGetLocation(event: *const c_void) -> CursorPoint;
    // 查询鼠标指定按键当前是否按下（stateID=0 组合会话状态，button=0 左键）。
    fn CGEventSourceButtonState(stateID: u32, button: u32) -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: *const c_void);
}

#[cfg(target_os = "macos")]
fn make_panel_float_on_top(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::NSObject;

    let panel = match window.to_panel::<BasicPanel>() {
        Ok(p) => p,
        Err(_) => return,
    };

    panel.set_level(PanelLevel::Floating.value());
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

    if let Ok(ptr) = window.ns_window() {
        let ns_window: *mut NSObject = ptr as *mut NSObject;
        if !ns_window.is_null() {
            let flags: u64 = 1 | 16 | 256 | 1024;
            unsafe {
                let _: () = msg_send![ns_window, setCollectionBehavior: flags];
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn start_refresh_loop(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        let mut refresh_counter = 0u8;
        loop {
            // ~60fps（16ms）：果冻拖拽需要平滑的光标速度流。
            std::thread::sleep(Duration::from_millis(16));
            refresh_counter = refresh_counter.wrapping_add(1);
            let h = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                if let Some(window) = h.get_webview_window("main") {
                    if refresh_counter % 125 == 0 {
                        // 每 ~2s 重申置顶，防止被其他窗口抢层级。
                        make_panel_float_on_top(&window);
                    }

                    let event = unsafe { CGEventCreate(ptr::null()) };
                    if event.is_null() {
                        return;
                    }
                    let cursor = unsafe { CGEventGetLocation(event) };
                    unsafe { CFRelease(event) };

                    // 左键按下状态：拖动窗口时 WebView 收不到 pointerup，
                    // 前端靠这里同步「是否仍在拖拽」。
                    let left_down = unsafe { CGEventSourceButtonState(0, 0) };

                    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size())
                    {
                        let center_x = position.x as f64 + size.width as f64 / 2.0;
                        let center_y = position.y as f64 + size.height as f64 / 2.0;
                        let _ = h.emit(
                            "cursor-position",
                            serde_json::json!({
                                "x": cursor.x,
                                "y": cursor.y,
                                "dx": cursor.x - center_x,
                                "dy": cursor.y - center_y,
                                "down": left_down
                            }),
                        );
                    }
                }
            });
        }
    });
}

// ============================================================
// 开机自启（macOS LaunchAgent）
// ============================================================

#[cfg(target_os = "macos")]
fn launch_agent_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(LAUNCH_AGENT_FILENAME)
}

#[cfg(target_os = "macos")]
fn current_exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn write_launch_agent(enabled: bool) -> std::io::Result<()> {
    let plist_path = launch_agent_path();
    let dir = plist_path.parent().unwrap();
    std::fs::create_dir_all(dir)?;

    if !enabled {
        if plist_path.exists() {
            std::fs::remove_file(&plist_path)?;
        }
        // 清理 launchctl 注册
        let _ = std::process::Command::new("launchctl")
            .args(["remove", LAUNCH_AGENT_LABEL])
            .output();
        return Ok(());
    }

    let exe = current_exe_path();
    if exe.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "cannot resolve current executable path",
        ));
    }

    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#,
        label = LAUNCH_AGENT_LABEL,
        exe = exe
    );

    std::fs::write(&plist_path, plist)?;

    // 注册到 launchctl
    let _ = std::process::Command::new("launchctl")
        .args(["load", plist_path.to_str().unwrap_or_default()])
        .output();
    Ok(())
}

#[cfg(target_os = "macos")]
fn startup_enabled() -> bool {
    launch_agent_path().exists()
}

#[cfg(not(target_os = "macos"))]
fn startup_enabled() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
fn write_launch_agent(_enabled: bool) -> std::io::Result<()> {
    Ok(())
}

fn set_startup(enabled: bool) -> Result<(), String> {
    write_launch_agent(enabled).map_err(|e| format!("设置开机自启失败: {e}"))
}

fn center_window(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = window.outer_size().unwrap_or_default();
        let x = monitor.position().x + (monitor.size().width - size.width) as i32 / 2;
        let y = monitor.position().y + (monitor.size().height - size.height) as i32 / 2;
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )));
    }
}

/// 读取当前窗口 frame：返回 (origin_x, origin_y, width, height)，单位点。
#[cfg(target_os = "macos")]
fn current_frame(window: &tauri::WebviewWindow) -> (f64, f64, f64, f64) {
    use objc2::msg_send;
    use objc2::runtime::NSObject;
    use objc2_foundation::NSRect;

    if let Ok(ptr) = window.ns_window() {
        let ns_window: *mut NSObject = ptr as *mut NSObject;
        if !ns_window.is_null() {
            unsafe {
                let frame: NSRect = msg_send![ns_window, frame];
                return (frame.origin.x, frame.origin.y, frame.size.width, frame.size.height);
            }
        }
    }
    (0.0, 0.0, WINDOW_WIDTH, WINDOW_HEIGHT)
}

/// 以 (cx, cy) 为中心、w×h 尺寸，用原生 `setFrame:display:` 原子设置窗口 frame。
/// 单帧原子生效，配合逐帧插值即可得到平滑动画。
#[cfg(target_os = "macos")]
fn set_frame_centered(window: &tauri::WebviewWindow, cx: f64, cy: f64, w: f64, h: f64) {
    use objc2::msg_send;
    use objc2::runtime::NSObject;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    if let Ok(ptr) = window.ns_window() {
        let ns_window: *mut NSObject = ptr as *mut NSObject;
        if ns_window.is_null() {
            return;
        }
        unsafe {
            let new_rect = NSRect {
                origin: NSPoint::new(cx - w / 2.0, cy - h / 2.0),
                size: NSSize { width: w, height: h },
            };
            let _: () = msg_send![ns_window, setFrame: new_rect, display: true];
        }
    }
}

/// 当前窗口主显示器屏幕中心（点单位）。
#[cfg(target_os = "macos")]
fn screen_center_point(window: &tauri::WebviewWindow) -> (f64, f64) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = window.scale_factor().unwrap_or(1.0);
        let cx = (monitor.position().x as f64 + monitor.size().width as f64 / 2.0) / scale;
        let cy = (monitor.position().y as f64 + monitor.size().height as f64 / 2.0) / scale;
        (cx, cy)
    } else {
        (0.0, 0.0)
    }
}

/// 逐帧平滑动画：从 (start_cx, start_cy, start_w, start_h) 用 ease-out 插值到
/// (target_cx, target_cy, target_w, target_h)，每 16ms 一帧、共 25 帧（约 0.4s）。
///
/// 必须在后台线程调用（本函数内部会 sleep 阻塞），每帧通过 run_on_main_thread
/// 设置 frame。动画在函数返回前完成 → JS invoke resolve 即代表动画结束。
#[cfg(target_os = "macos")]
fn animate_zoom(
    app: &tauri::AppHandle,
    start_cx: f64,
    start_cy: f64,
    start_w: f64,
    start_h: f64,
    target_cx: f64,
    target_cy: f64,
    target_w: f64,
    target_h: f64,
) {
    const FRAME_MS: u64 = 16;
    const FRAMES: u64 = 25;

    for i in 1..=FRAMES {
        let t = i as f64 / FRAMES as f64;
        // ease-out cubic：先快后慢，贴近 macOS 原生手感。
        let e = 1.0 - (1.0 - t).powi(3);
        let cx = start_cx + (target_cx - start_cx) * e;
        let cy = start_cy + (target_cy - start_cy) * e;
        let w = start_w + (target_w - start_w) * e;
        let h = start_h + (target_h - start_h) * e;

        if let Some(window) = app.get_webview_window("main") {
            let _ = app.run_on_main_thread(move || {
                set_frame_centered(&window, cx, cy, w, h);
            });
        }
        std::thread::sleep(Duration::from_millis(FRAME_MS));
    }

    // 最后一帧精确到位，避免时序误差。
    if let Some(window) = app.get_webview_window("main") {
        let _ = app.run_on_main_thread(move || {
            set_frame_centered(&window, target_cx, target_cy, target_w, target_h);
        });
    }
}

// 窗口固定尺寸，永不 resize。函数保留仅作占位（旧调用残留），实际不做任何改动。
fn set_window_panel_mode(_window: &WebviewWindow, _expanded: bool) -> tauri::Result<()> {
    Ok(())
}

// ============================================================
// 菜单
// ============================================================

fn emit_water_reminder(app: &tauri::AppHandle) {
    let _ = app.emit("water-reminder-now", ());
}

fn build_settings_submenu(
    app: &tauri::AppHandle,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let pin_checked = *app.state::<AlwaysOnTop>().0.lock().unwrap();
    let pin_item = CheckMenuItem::with_id(app, "pin", "窗口置顶", true, pin_checked, None::<&str>)?;
    let center_item = MenuItem::with_id(app, "center", "回到屏幕中央", true, None::<&str>)?;
    let startup_checked = *app.state::<StartupEnabled>().0.lock().unwrap();
    let startup_item =
        CheckMenuItem::with_id(app, "todo_startup", "开机自启", true, startup_checked, None::<&str>)?;
    tauri::menu::Submenu::with_items(app, "设置", true, &[&pin_item, &center_item, &startup_item])
}

fn build_context_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let title = MenuItem::with_id(
        app,
        "title",
        format!("像素猫 v{}", APP_VERSION),
        false,
        None::<&str>,
    )?;
    let reminder = MenuItem::with_id(app, "water_reminder", "喝水提醒", true, None::<&str>)?;
    let pomodoro = MenuItem::with_id(app, "pomodoro", "番茄钟", true, None::<&str>)?;
    let stretch = MenuItem::with_id(app, "todo_stretch", "休息拉伸", true, None::<&str>)?;
    let settings = build_settings_submenu(app)?;
    let tell_name = MenuItem::with_id(app, "todo_name", "告诉我名字", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏宠物", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出像素猫", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &title,
            &PredefinedMenuItem::separator(app)?,
            &reminder,
            &pomodoro,
            &stretch,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &tell_name,
            &PredefinedMenuItem::separator(app)?,
            &hide,
            &quit,
        ],
    )
}

fn build_tray_menu(
    app: &tauri::AppHandle,
) -> tauri::Result<(Menu<tauri::Wry>, CheckMenuItem<tauri::Wry>)> {
    let title = MenuItem::with_id(
        app,
        "title",
        format!("像素猫 v{}", APP_VERSION),
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "显示宠物", true, None::<&str>)?;
    let pin_checked = *app.state::<AlwaysOnTop>().0.lock().unwrap();
    let pin_item = CheckMenuItem::with_id(app, "pin", "窗口置顶", true, pin_checked, None::<&str>)?;
    let center_item = MenuItem::with_id(app, "center", "回到屏幕中央", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出像素猫", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &title,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &PredefinedMenuItem::separator(app)?,
            &pin_item,
            &center_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    Ok((menu, pin_item))
}

#[tauri::command]
fn show_context_menu(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    let menu = build_context_menu(&app).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    if let Ok(panel) = window.to_panel::<BasicPanel>() {
        panel.make_key_window();
    }

    window.popup_menu(&menu).map_err(|e| e.to_string())
}

fn menu_event_handler(app: &tauri::AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    let window = app.get_webview_window("main");
    match id {
        "quit" => app.exit(0),
        "center" => {
            if let Some(ref w) = window {
                center_window(w);
            }
        }
        "hide" => {
            if let Some(ref w) = window {
                let _ = set_window_panel_mode(w, false);
                if let Ok(mut expanded) = app.state::<PanelExpanded>().0.lock() {
                    *expanded = false;
                }
                let _ = w.hide();
            }
        }
        "show" => {
            if let Some(ref w) = window {
                let _ = w.show();
                #[cfg(target_os = "macos")]
                make_panel_float_on_top(w);
            }
        }
        "pin" => {
            let pinned = {
                let state = app.state::<AlwaysOnTop>();
                let mut guard = state.0.lock().unwrap();
                *guard = !*guard;
                *guard
            };
            if let Some(ref w) = window {
                let _ = w.set_always_on_top(pinned);
                #[cfg(target_os = "macos")]
                make_panel_float_on_top(w);
            }
            sync_pin_checks(app, pinned);
        }
        "pomodoro" => {
            if let Some(ref w) = window {
                let _ = set_window_panel_mode(w, true);
            }
            #[cfg(target_os = "macos")]
            if let Some(ref w) = window {
                if let Ok(panel) = w.to_panel::<BasicPanel>() {
                    panel.make_key_window();
                }
            }
            let _ = app.emit("open-pomodoro", ());
        }
        "water_reminder" => emit_water_reminder(app),
        "todo_stretch" => {
            let _ = app.emit("stretch-reminder-now", ());
        }
        "todo_name" => {
            let _ = app.emit("open-name-dialog", ());
        }
        "todo_startup" => {
            let enabled = {
                let state = app.state::<StartupEnabled>();
                let mut guard = state.0.lock().unwrap();
                *guard = !*guard;
                *guard
            };
            match set_startup(enabled) {
                Ok(()) => {
                    let _ = app.emit(
                        "show-toast",
                        if enabled { "已开启开机自启" } else { "已关闭开机自启" },
                    );
                }
                Err(e) => {
                    // 失败时回滚勾选状态
                    let state = app.state::<StartupEnabled>();
                    let mut guard = state.0.lock().unwrap();
                    *guard = !enabled;
                    let _ = app.emit("show-toast", e);
                }
            }
        }
        _ => {}
    }
}

fn sync_pin_checks(app: &tauri::AppHandle, pinned: bool) {
    let state = app.state::<TrayPinItem>();
    let guard = state.0.lock().unwrap();
    if let Some(item) = guard.as_ref() {
        let _ = item.set_checked(pinned);
    }
}

#[tauri::command]
fn keep_on_top(state: tauri::State<'_, AppWindow>) {
    #[cfg(target_os = "macos")]
    if let Some(ref window) = *state.0.lock().unwrap() {
        make_panel_float_on_top(window);
    }
}

/// JS 调用：让 panel 成为 key window，使 WebView 能接收鼠标点击。
#[tauri::command]
fn make_panel_key(state: tauri::State<'_, AppWindow>) {
    #[cfg(target_os = "macos")]
    if let Some(ref window) = *state.0.lock().unwrap() {
        if let Ok(panel) = window.to_panel::<BasicPanel>() {
            panel.make_key_window();
        }
    }
}

#[tauri::command]
fn set_panel_expanded(
    expanded: bool,
    state: tauri::State<'_, AppWindow>,
    expanded_state: tauri::State<'_, PanelExpanded>,
) -> Result<(), String> {
    let mut guard = expanded_state.0.lock().unwrap();
    if *guard == expanded {
        return Ok(());
    }

    if let Some(ref window) = *state.0.lock().unwrap() {
        set_window_panel_mode(window, expanded).map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        make_panel_float_on_top(window);
    }

    *guard = expanded;
    Ok(())
}

// 窗口固定、永不动：喝水提醒只是在窗口内显示 UI，无需移动窗口。
#[tauri::command]
fn focus_water_reminder(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

// 窗口固定、永不动：名字弹窗只是显示/隐藏，无需移动窗口。
#[tauri::command]
fn focus_name_dialog(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

// 窗口固定、永不动：关闭名字弹窗无窗口动画。
#[tauri::command]
fn restore_name_dialog() -> Result<(), String> {
    Ok(())
}

// 窗口固定、永不动：恢复喝水提醒无窗口动画。
#[tauri::command]
fn restore_water_reminder() -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .manage(AppWindow(Mutex::new(None)))
        .manage(PanelExpanded(Mutex::new(false)))
        .manage(WaterRestoreState(Mutex::new(None)))
        .manage(AlwaysOnTop(Mutex::new(true)))
        .manage(TrayPinItem(Mutex::new(None)))
        .manage(StartupEnabled(Mutex::new(startup_enabled())))
        .invoke_handler(tauri::generate_handler![
            keep_on_top,
            show_context_menu,
            make_panel_key,
            set_panel_expanded,
            focus_water_reminder,
            restore_water_reminder,
            focus_name_dialog,
            restore_name_dialog
        ])
        .on_menu_event(menu_event_handler)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(window) = app.get_webview_window("main") {
                app.state::<AppWindow>()
                    .0
                    .lock()
                    .unwrap()
                    .replace(window.clone());

                #[cfg(target_os = "macos")]
                make_panel_float_on_top(&window);

                #[cfg(target_os = "macos")]
                if let Ok(panel) = window.to_panel::<BasicPanel>() {
                    panel.show_and_make_key();
                }

                #[cfg(target_os = "macos")]
                start_refresh_loop(app.handle().clone());

                // 初始窗口 = 固定 260×305，启动后永不 resize/移动。
                let _ = window.set_size(Size::Logical(LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT)));
                center_window(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }

            let (tray_menu, pin_item) = build_tray_menu(app.handle())?;
            app.state::<TrayPinItem>()
                .0
                .lock()
                .unwrap()
                .replace(pin_item);
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().expect("no window icon"))
                .icon_as_template(true)
                .tooltip(format!("像素猫 v{}", APP_VERSION))
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(menu_event_handler)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            #[cfg(target_os = "macos")]
                            make_panel_float_on_top(&window);
                        }
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                match Tap::new() {
                    Ok(tap) => {
                        for event in tap.iter() {
                            if let EventKind::KeyDown(_) = event.kind {
                                let _ = handle.emit("typing", ());
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!(
                            "Failed to start global keyboard listener. Check macOS Accessibility permission: {err}"
                        );
                        // Do not open System Settings from the listener thread. On some macOS
                        // versions that re-entrant launch can terminate the panel process before
                        // the pet window becomes visible. The tray/context menu remains usable,
                        // and the permission can be granted manually for this stable app id.
                        let _ = handle.emit(
                            "show-toast",
                            "需要在系统设置里允许辅助功能/输入监控，授权后请重启像素猫",
                        );
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
