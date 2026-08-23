use keytap::{EventKind, Tap};
#[cfg(target_os = "macos")]
use std::ffi::c_void;
#[cfg(target_os = "macos")]
use std::ptr;
use std::process::Command;
use std::sync::Mutex;
use std::collections::HashMap;
use std::time::Duration; // macOS/Windows 的 start_refresh_loop 都用它 sleep 光标轮询
use tauri::menu::CheckMenuItem;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use serde::Serialize;
use tauri::command;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, LogicalSize, Manager, Size, WebviewWindow};

// macOS 专属：NSPanel 相关
#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, PanelLevel, StyleMask, WebviewWindowExt};

struct AppWindow(Mutex<Option<WebviewWindow>>);
struct PanelExpanded(Mutex<bool>);

/// 小猫在窗口内的命中矩形（逻辑像素，相对窗口左上角）。
/// 由前端每 ~100ms 上报（canvas 非透明像素包围盒 → 屏幕坐标映射）。
/// 用于"点击穿透"：光标落在猫上 → 关闭穿透（可交互）；否则 → 开启穿透
/// （窗口透明区域不拦截鼠标，下层应用可正常点击）。
struct CatHitbox(Mutex<Option<(f64, f64, f64, f64)>>);

/// 是否正在拖拽窗口：拖拽期间光标可能瞬时划过透明区，必须保持可交互。
/// 前端 pointerdown 置 true，pointerup/pointercancel 置 false。
struct WindowDragging(Mutex<bool>);

/// 当前是否处于"点击穿透"（set_ignore_cursor_events(true)）状态。
/// 避免每帧重复切换（切一次会重建 WebView 鼠标跟踪）。
struct CursorPassThrough(Mutex<bool>);

/// 「窗口置顶」开关状态。右键菜单与 Tray 菜单共享同一份状态。
struct AlwaysOnTop(Mutex<bool>);

/// Tray 菜单里 id="pin" 的勾选项引用，便于勾选状态同步。
struct TrayPinItem(Mutex<Option<CheckMenuItem<tauri::Wry>>>);

/// 开机自启开关状态。
struct StartupEnabled(Mutex<bool>);

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
// 窗口固定尺寸 260×305：启动后永不 resize/移动（避免 WKWebView 重排导致猫闪烁）。
// 宽度 = 名字输入框 258px 左右各多 1px；高度 = 金色输入框底部 290px + 15px 间距。
// 布局：顶部 0~96px 气泡区；猫固定在 96~224px（水平居中）；
// 猫下方 224~305px 为番茄钟倒计时/按钮、名字输入框区域。
const WINDOW_WIDTH: f64 = 260.0;
const WINDOW_HEIGHT: f64 = 305.0;

// macOS LaunchAgent 文件名：com.comnyang.app.plist（仅 macOS 用）
#[cfg(target_os = "macos")]
const LAUNCH_AGENT_LABEL: &str = "com.comnyang.app";
#[cfg(target_os = "macos")]
const LAUNCH_AGENT_FILENAME: &str = "com.comnyang.app.plist";

#[cfg(target_os = "macos")]
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

                    // 点击穿透：光标不在猫上 → 窗口透明区让鼠标穿透到下层应用。
                    update_cursor_passthrough(&window, cursor.x, cursor.y);

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
// 点击穿透（click-through）：窗口透明区域不拦截鼠标
// ============================================================
// 原理：前端每 ~100ms 上报「猫在窗口内的命中矩形」（canvas 非透明像素包围盒，
// CSS 逻辑像素）；本函数每 16ms（光标轮询线程主线程闭包）判断光标是否落在该
// 矩形内，动态切换 set_ignore_cursor_events：
//   - 光标在猫上 或 正在拖拽（左键按下）→ 关闭穿透（ignore=false），可交互；
//   - 光标落在透明区 → 开启穿透（ignore=true），鼠标点击直接穿透到下层应用。
// 为什么不能在 JS 里做：穿透开启时 WebView 收不到任何鼠标事件，只能由 Rust 侧
// 独立轮询光标来判定。
fn update_cursor_passthrough(window: &tauri::WebviewWindow, screen_x: f64, screen_y: f64) {
    let app_handle = window.app_handle();
    let dragging = *app_handle.state::<WindowDragging>().0.lock().unwrap();
    let hitbox = *app_handle.state::<CatHitbox>().0.lock().unwrap();

    let current_ignore = *app_handle.state::<CursorPassThrough>().0.lock().unwrap();

    // 坐标约定：screen_x/screen_y 为「屏幕逻辑像素」；hitbox 由前端用
    // outerPosition（物理）÷ scale_factor + getBoundingClientRect（逻辑）换算成
    // 屏幕逻辑坐标上报。两者同基准，直接比较即可，避免窗口原点/DPI 换算偏差。
    let inside = if dragging || left_button_down() {
        // 拖拽中或左键按下：保持可交互（即使瞬时划过透明区也不穿透）
        true
    } else if let Some((hx, hy, hw, hh)) = hitbox {
        screen_x >= hx
            && screen_x < hx + hw
            && screen_y >= hy
            && screen_y < hy + hh
    } else {
        true // hitbox 还没上报（启动瞬间）→ 保持可交互，避免刚启动就点不动
    };

    let want_ignore = !inside;
    if want_ignore != current_ignore {
        let _ = window.set_ignore_cursor_events(want_ignore);
        *app_handle.state::<CursorPassThrough>().0.lock().unwrap() = want_ignore;
    }
}

// 左键是否正在按下（macOS/Windows 各自实现，见 start_refresh_loop）。
#[cfg(target_os = "macos")]
fn left_button_down() -> bool {
    unsafe { CGEventSourceButtonState(0, 0) }
}
#[cfg(windows)]
fn left_button_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    (unsafe { GetAsyncKeyState(0x01) } & i16::MIN) != 0
}
#[cfg(not(any(target_os = "macos", windows)))]
fn left_button_down() -> bool {
    false
}

// ========== Windows 光标轮询（驱动眼睛转动 + 身体形变） ==========
// macOS 用 CoreGraphics 每 16ms 读一次光标并 emit "cursor-position"；
// Windows 用 GetCursorPos + GetAsyncKeyState 实现同样的 cursor-position 事件流，
// 否则前端 handleCursorPosition 收不到事件 → 眼睛不转、身体不动。
#[cfg(windows)]
fn start_refresh_loop(app_handle: tauri::AppHandle) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        loop {
            // ~60fps（16ms）：与 macOS 版一致，给果冻拖拽平滑的光标速度流。
            std::thread::sleep(Duration::from_millis(16));
            let h = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                if let Some(window) = h.get_webview_window("main") {
                    // 读取屏幕光标位置（物理像素）
                    let mut point = POINT { x: 0, y: 0 };
                    let ok = unsafe { GetCursorPos(&mut point) };
                    if ok == 0 {
                        return;
                    }
                    // 点击穿透：光标不在猫上 → 窗口透明区让鼠标穿透到下层应用。
                    // GetCursorPos 返回物理像素，统一换算成屏幕逻辑像素再判定。
                    let cscale = window.scale_factor().unwrap_or(1.0);
                    update_cursor_passthrough(&window, point.x as f64 / cscale, point.y as f64 / cscale);

                    // 左键是否按下（VK_LBUTTON = 0x01）：拖动时同步"仍在拖拽"。
                    // GetAsyncKeyState 返回 i16，用 i16::MIN（=-32768，即 0x8000 高位）
                    // 检测最高位是否为 1（键被按下）；0x8000i16 字面量会溢出，不能用。
                    let left_down = (unsafe { GetAsyncKeyState(0x01) } & i16::MIN) != 0;

                    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size())
                    {
                        let center_x = position.x as f64 + size.width as f64 / 2.0;
                        let center_y = position.y as f64 + size.height as f64 / 2.0;
                        let _ = h.emit(
                            "cursor-position",
                            serde_json::json!({
                                "x": point.x as f64,
                                "y": point.y as f64,
                                "dx": point.x as f64 - center_x,
                                "dy": point.y as f64 - center_y,
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
    // 喝水提醒、休息拉伸、番茄钟：集成到一个「功能」子菜单。
    let reminder = MenuItem::with_id(app, "water_reminder", "喝水提醒", true, None::<&str>)?;
    let pomodoro = MenuItem::with_id(app, "pomodoro", "番茄钟", true, None::<&str>)?;
    let stretch = MenuItem::with_id(app, "todo_stretch", "休息拉伸", true, None::<&str>)?;
    let actions = tauri::menu::Submenu::with_items(
        app,
        "功能",
        true,
        &[&reminder, &pomodoro, &stretch],
    )?;

    // 「音乐」按钮：打开独立 YouTube 音乐播放器窗口
    let music = MenuItem::with_id(app, "music", "音乐", true, None::<&str>)?;

    let settings = build_settings_submenu(app)?;
    let choose_cat = MenuItem::with_id(app, "choose_cat", "更换小猫", true, None::<&str>)?;
    let tell_name = MenuItem::with_id(app, "todo_name", "告诉我名字", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &actions,
            &PredefinedMenuItem::separator(app)?,
            &choose_cat,
            &tell_name,
            &PredefinedMenuItem::separator(app)?,
            &music,
            &PredefinedMenuItem::separator(app)?,
            &settings, // 设置子菜单放最底部
        ],
    )
}

fn build_tray_menu(
    app: &tauri::AppHandle,
) -> tauri::Result<(Menu<tauri::Wry>, CheckMenuItem<tauri::Wry>)> {
    let title = MenuItem::with_id(
        app,
        "title",
        format!("Comnyang 像素猫 v{}", APP_VERSION),
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
        "music" => {
            let _ = show_player(app.clone());
        }
        "water_reminder" => emit_water_reminder(app),
        "choose_cat" => {
            let _ = app.emit("open-cat-dialog", ());
        }
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

// ============================================================
// 音乐播放器（YouTube / yt-dlp）
// 集成自 my-player 项目：搜索、获取音频流、获取标题三个命令，
// 通过系统 yt-dlp + node 解析 YouTube 音频流。
// ============================================================

#[derive(Serialize, Clone)]
struct SearchItem {
    video_id: String,
    title: String,
    author: String,
    duration: u64,
    thumbnail: Option<String>,
}

#[derive(Serialize, Clone)]
struct AudioStream {
    url: String,
    title: String,
    author: String,
    /// 视频真实时长（秒），由 yt-dlp 提供。WebKit 的 audio.duration 对某些流
    /// 读取不准（如 4 分钟被读成 8 分钟），前端应优先用本字段显示总时长。
    duration: u64,
}

// 音频流解析结果缓存：key = 视频完整 URL。解析一次（约 4s）后缓存，
// 同一视频再次播放/切换直接命中秒开，避免每次都重新跑 yt-dlp。
static AUDIO_CACHE: Mutex<Option<HashMap<String, AudioStream>>> = Mutex::new(None);

// 搜索结果缓存：key = 搜索关键词（小写）。同一关键词不重复搜索，直接返回缓存。
static SEARCH_CACHE: Mutex<Option<HashMap<String, Vec<SearchItem>>>> = Mutex::new(None);

/// 把 "2:15" / "1:02:33" 解析为秒数。
fn parse_duration(s: &str) -> u64 {
    let parts: Vec<&str> = s.trim().split(':').collect();
    let mut seconds: u64 = 0;
    for part in parts {
        seconds = seconds * 60 + part.parse::<u64>().unwrap_or(0);
    }
    seconds
}

/// 返回 yt-dlp 命令。**仅发布版（release，即打包后的应用）**使用随应用捆绑的
/// sidecar 二进制（Tauri externalBin 放在可执行文件同目录：Windows 为
/// `yt-dlp.exe`，macOS 为 `Contents/MacOS/yt-dlp`；也兼容 `bin/` 子目录）。
/// 开发/调试模式（debug）一律用系统 PATH 中的 `yt-dlp`，避免 target 目录里的
/// 残留/慢速二进制干扰（否则可能误用捆绑的单文件版导致搜索 20s+）。
fn ytdlp_cmd() -> Command {
    // debug 构建（开发调试）→ 直接走系统 yt-dlp
    if cfg!(debug_assertions) {
        return std::process::Command::new("yt-dlp");
    }

    let mut cmd = std::process::Command::new("yt-dlp");
    // 仅 release 模式才尝试使用捆绑 sidecar
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar_name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
            // 1) exe 同目录（Tauri macOS 实际位置）
            let same_dir = dir.join(sidecar_name);
            // 2) bin/ 子目录（兼容布局）
            let bin_dir = dir.join("bin").join(sidecar_name);
            if same_dir.is_file() {
                cmd = std::process::Command::new(same_dir);
            } else if bin_dir.is_file() {
                cmd = std::process::Command::new(bin_dir);
            }
        }
    }
    cmd
}


#[command]
async fn search_youtube(query: String) -> Result<Vec<SearchItem>, String> {
    // 命中缓存直接返回（同一关键词秒回）
    let cache_key = query.trim().to_lowercase();
    if let Ok(guard) = SEARCH_CACHE.lock() {
        if let Some(map) = guard.as_ref() {
            if let Some(hit) = map.get(&cache_key) {
                return Ok(hit.clone());
            }
        }
    }

    let output = ytdlp_cmd()
        .args([
            &format!("ytsearch5:{}", query),
            "--print",
            "id",
            "--print",
            "title",
            "--print",
            "duration",
            "--print",
            "uploader",
            "--no-playlist",
            "--js-runtimes",
            "node",
        ])
        .output()
        .map_err(|e| format!("yt-dlp 执行失败: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp 搜索错误: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    let mut items = Vec::new();
    let mut i = 0;
    // yt-dlp --print 输出顺序：id, title, duration, uploader（每视频 4 行）
    while i + 3 < lines.len() {
        let video_id = lines[i].trim().to_string();
        let title = lines[i + 1].trim().to_string();
        let duration_str = lines[i + 2].trim();
        let duration: u64 = duration_str.parse().unwrap_or_else(|_| parse_duration(duration_str));
        let author = lines[i + 3].trim().to_string();
        items.push(SearchItem {
            video_id,
            title,
            author,
            duration,
            thumbnail: None,
        });
        i += 4;
    }
    // 写入搜索缓存，同一关键词下次秒回
    if let Ok(mut guard) = SEARCH_CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(cache_key, items.clone());
    }
    Ok(items)
}

#[command]
async fn get_video_title(url: String) -> Result<String, String> {
    let full_url = if url.starts_with("http") {
        url
    } else {
        format!("https://youtube.com/watch?v={}", url)
    };

    let output = ytdlp_cmd()
        .args([
            "--get-title",
            "--no-playlist",
            "--js-runtimes",
            "node",
            &full_url,
        ])
        .output()
        .map_err(|e| format!("yt-dlp 执行失败: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp 错误: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let title = stdout
        .lines()
        .next()
        .ok_or("未获取到标题")?
        .trim()
        .to_string();

    Ok(title)
}

#[command]
async fn get_audio_stream(url: String) -> Result<AudioStream, String> {
    let full_url = if url.starts_with("http") {
        url
    } else {
        format!("https://youtube.com/watch?v={}", url)
    };

    // 命中缓存直接返回（同一视频秒开，避免重复跑 yt-dlp 解析）
    if let Ok(guard) = AUDIO_CACHE.lock() {
        if let Some(map) = guard.as_ref() {
            if let Some(hit) = map.get(&full_url) {
                return Ok(hit.clone());
            }
        }
    }

    let output = ytdlp_cmd()
        .args([
            "-f",
            // 优先 m4a/AAC（WebKit 对 AAC 的 seek 支持完善），回退到其他音频。
            // 注意：不能用 webm/opus，Tauri 的 WebKit 对 opus 流 seek（拖动进度条）后
            // 缓冲恢复支持差 → 跳到中间会无声。m4a 是最稳的。
            "bestaudio[ext=m4a]/bestaudio",
            "--print",
            "title",
            "--print",
            "url",
            "--print",
            "uploader",
            "--print",
            "duration",
            "--no-playlist",
            "--js-runtimes",
            "node",
            &full_url,
        ])
        .output()
        .map_err(|e| format!("yt-dlp 执行失败: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp 错误: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    // yt-dlp --print 顺序：title | url | uploader | duration
    let title = lines.next().ok_or("未获取到标题")?.trim().to_string();
    let audio_url = lines.next().ok_or("未获取到音频URL")?.trim().to_string();
    let author = lines.next().unwrap_or("").trim().to_string();
    let duration_str = lines.next().unwrap_or("0").trim();
    // duration 可能是纯秒数（如 "240"）或 "4:00" / "1:02:33" 格式
    let duration: u64 = duration_str
        .parse()
        .unwrap_or_else(|_| parse_duration(duration_str));

    let stream = AudioStream { url: audio_url, title, author, duration };
    // 写入缓存，同一视频下次播放秒开
    if let Ok(mut guard) = AUDIO_CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(full_url, stream.clone());
    }
    Ok(stream)
}

/// 显示/隐藏独立音乐播放器窗口（macOS 上转成 NSPanel，其他平台直接显示/隐藏）。
#[tauri::command]
fn show_player(app: tauri::AppHandle) -> Result<(), String> {
    // 通知主窗口：音乐播放器打开 → 猫戴上耳机
    let _ = app.emit("player-open", ());
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("player") {
            if let Ok(panel) = window.to_panel::<BasicPanel>() {
                panel.show_and_make_key();
                return Ok(());
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("player") {
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(());
        }
    }
    Err("player window not ready".into())
}

/// ✕ 完全退出播放器：停止音频 + 隐藏窗口。再次点「音乐」重新打开。
#[tauri::command]
fn close_player(app: tauri::AppHandle) -> Result<(), String> {
    // 通知前端停止音频并清空播放器
    let _ = app.emit("player-exit", ());
    if let Some(window) = app.get_webview_window("player") {
        let _ = window.hide();
        return Ok(());
    }
    Err("player window not ready".into())
}

/// （-）最小化到后台：仅隐藏窗口，音频继续后台播放。
/// 再次点「音乐」即可恢复窗口控制。
#[tauri::command]
fn minimize_player(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("player") {
        let _ = window.hide();
        return Ok(());
    }
    Err("player window not ready".into())
}

/// 前端上报「猫在窗口内的命中矩形」（逻辑像素，相对窗口左上角）。
/// 由 canvas 非透明像素包围盒计算，每 ~100ms 上报一次；Rust 侧据此动态
/// 切换 set_ignore_cursor_events，实现"透明穿透、猫体可交互"。
#[tauri::command]
fn set_pet_hitbox(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, CatHitbox>,
) {
    let mut guard = state.0.lock().unwrap();
    *guard = if width > 0.0 && height > 0.0 {
        Some((x, y, width, height))
    } else {
        None
    };
}

/// 前端通知是否正在拖拽窗口（pointerdown=true / pointerup|pointercancel=false）。
#[tauri::command]
fn set_window_dragging(dragging: bool, state: tauri::State<'_, WindowDragging>) {
    *state.0.lock().unwrap() = dragging;
}

#[tauri::command]
fn keep_on_top(state: tauri::State<'_, AppWindow>) {
    #[cfg(target_os = "macos")]
    if let Some(ref window) = *state.0.lock().unwrap() {
        make_panel_float_on_top(window);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = state;
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
    #[cfg(not(target_os = "macos"))]
    let _ = state;
}

// 显示/隐藏独立喝水记录面板（macOS 上用 NSPanel，其他平台直接显示窗口）。前端通过
// invoke 调用这两个命令即可打开/关闭大面板，无需抢占小猫主窗口空间。
#[tauri::command]
fn show_water_log(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("water-log") {
            if let Ok(panel) = window.to_panel::<BasicPanel>() {
                panel.show_and_make_key();
                return Ok(());
            }
        }
    }
    // Windows/Linux：直接显示窗口
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("water-log") {
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(());
        }
    }
    Err("panel not ready".into())
}

#[tauri::command]
fn hide_water_log(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("water-log") {
            if let Ok(panel) = window.to_panel::<BasicPanel>() {
                panel.hide();
            }
        }
    }
    // Windows/Linux：直接隐藏窗口
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("water-log") {
            let _ = window.hide();
        }
    }
    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // macOS 需要 builder 可变（注册 NSPanel 插件）；Windows/Linux 上不用可变。
    // 用 cfg_attr 消除非 macOS 的 unused_mut 警告又不影响 macOS 的可变需求。
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    // macOS 专属：NSPanel 插件（全屏覆盖）
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .manage(AppWindow(Mutex::new(None)))
        .manage(PanelExpanded(Mutex::new(false)))
        .manage(CatHitbox(Mutex::new(None)))
        .manage(WindowDragging(Mutex::new(false)))
        .manage(CursorPassThrough(Mutex::new(false)))
        .manage(AlwaysOnTop(Mutex::new(true)))
        .manage(TrayPinItem(Mutex::new(None)))
        // 开机自启默认开启：调用 startup_enabled()（保留函数引用避免 dead_code）
        // 再用 || true 强制默认 true，并在 setup 里自动写入 LaunchAgent。
        .manage(StartupEnabled(Mutex::new(startup_enabled() || true)))
        .invoke_handler(tauri::generate_handler![
            keep_on_top,
            show_context_menu,
            make_panel_key,
            set_panel_expanded,
            show_water_log,
            hide_water_log,
            set_pet_hitbox,
            set_window_dragging,
            search_youtube,
            get_audio_stream,
            get_video_title,
            show_player,
            close_player,
            minimize_player
        ])
        .on_menu_event(menu_event_handler)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 开机自启：默认开启（若 LaunchAgent 尚未写入则自动写入）。
            // 这样用户无需手动勾选，安装后即默认随系统启动。
            {
                let enabled = *app.state::<StartupEnabled>().0.lock().unwrap();
                if enabled {
                    let _ = set_startup(true);
                }
            }

            // 独立喝水记录面板：tauri.conf.json 预注册的透明无边框 water-log 窗口
            // 在此转成 NSPanel（与 main 同一路径，绝不用 PanelBuilder——它在已有
            // panel 的应用里创建第二个 panel 会在 did_finish_launching 处 panic）。
            // 默认隐藏；前端点「喝水提醒」时通过 show_water_log 命令显示。
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("water-log") {
                    make_panel_float_on_top(&window);
                    if let Ok(panel) = window.to_panel::<BasicPanel>() {
                        panel.hide();
                    }
                }
            }

            // 独立音乐播放器窗口：与 water-log 同一路径，转成 NSPanel 并默认隐藏；
            // 前端右键菜单「音乐」通过 show_player 命令显示。
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("player") {
                    make_panel_float_on_top(&window);
                    if let Ok(panel) = window.to_panel::<BasicPanel>() {
                        panel.hide();
                    }
                }
            }

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

                // 光标轮询：macOS 用 CoreGraphics、Windows 用 GetCursorPos，
                // 都推送 cursor-position 事件驱动眼睛转动 + 身体形变。
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
                .tooltip(format!("Comnyang 像素猫 v{}", APP_VERSION))

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
