use objc2::runtime::NSObject;
use keytap::{EventKind, Tap};
use tauri::{Emitter, Manager};

/// macOS: 让窗口浮在所有 Space 之上、不被台前调度(Stage Manager)收纳，
/// 并且在其他应用全屏时仍然可见。
///
/// NSWindowCollectionBehavior 位掩码:
///   CanJoinAllSpaces          = 1 << 0 = 1
///   MoveToActiveSpace         = 1 << 1 = 2
///   Transient                 = 1 << 2 = 4
///   Stationary                = 1 << 4 = 16
///   FullScreenAuxiliary       = 1 << 8 = 256
#[cfg(target_os = "macos")]
fn make_window_float_on_all_spaces(window: &tauri::WebviewWindow) {
    use objc2::msg_send;

    match window.ns_window() {
        Ok(ptr) => {
            let ns_window: *mut NSObject = ptr as *mut NSObject;
            if ns_window.is_null() {
                return;
            }
            // 关键标志：
            // CanJoinAllSpaces (1) + Transient (4) + Stationary (16) + FullScreenAuxiliary (256)
            // FullScreenAuxiliary 让窗口在其他应用全屏时仍然可见
            let flags: u64 = 1 | 4 | 16 | 256;
            unsafe {
                let _: () = msg_send![ns_window, setCollectionBehavior: flags];
            }
        }
        Err(_) => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // macOS: 设为 Accessory 应用，不显示在 Dock / 任务栏
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 配置窗口行为
            if let Some(window) = app.get_webview_window("main") {
                // 让小猫脱离台前调度、浮在所有桌面、全屏可见
                #[cfg(target_os = "macos")]
                make_window_float_on_all_spaces(&window);

                // 将窗口居中显示，方便第一眼看到
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let size = window.outer_size().unwrap_or_default();
                    let x = monitor.position().x
                        + (monitor.size().width - size.width) as i32 / 2;
                    let y = monitor.position().y
                        + (monitor.size().height - size.height) as i32 / 2;
                    let _ = window.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition::new(x, y),
                    ));
                }
            }

            // 全局键盘监听：keytap 可以监听到应用窗口之外的所有按键。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Ok(tap) = Tap::new() {
                    for event in tap.iter() {
                        if let EventKind::KeyDown(_) = event.kind {
                            let _ = handle.emit("typing", ());
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}