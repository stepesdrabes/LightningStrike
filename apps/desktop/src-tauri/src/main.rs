// The release build is a GUI app; a console window behind it would be Windows-only noise.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod env;
#[cfg(target_os = "macos")]
mod framerate;
mod server;

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The app's own top bar, which the window controls have to sit inside.
#[cfg(target_os = "macos")]
const TOP_BAR_HEIGHT: f64 = 56.0;

/// Align controls with the 56pt app bar by eye: tao sets container height to button height + y but
/// preserves AppKit's unpublished vertical padding.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_X: f64 = 20.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y: f64 = TOP_BAR_HEIGHT / 2.0 + 1.0;

/// Leading space the bar keeps clear of them: three buttons at 20pt spacing, plus a gap.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_INSET: f64 = 78.0;
#[cfg(not(target_os = "macos"))]
const TRAFFIC_LIGHT_INSET: f64 = 0.0;

fn main() {
	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.setup(|app| {
			let handle = app.handle().clone();

			// Gather only bounded work before creating the window.
			let path = env::resolve_path();
			let missing = env::missing_tools(&path);
			let started = server::spawn(&handle, &path);

			// Show the splash before starting the server. Only macOS reassigns this builder.
			#[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
			let mut builder =
				WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
					.title("LightningStrike")
					.inner_size(1440.0, 900.0)
					.min_inner_size(1024.0, 660.0)
					.resizable(true)
					.initialization_script(&shell_hints(&missing));

			#[cfg(target_os = "macos")]
			{
				use tauri::{LogicalPosition, TitleBarStyle};
				// Hide the native title so it does not overlap the app bar under the overlay.
				builder = builder
					.title_bar_style(TitleBarStyle::Overlay)
					.hidden_title(true)
					.traffic_light_position(LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y));
			}

			// A build failure bypasses RunEvent::Exit, so stop the sidecar explicitly.
			let window = builder.build().inspect_err(|_| server::stop(&handle))?;

			// Fullscreen hides window controls; update their reserved space through a CSS property.
			#[cfg(target_os = "macos")]
			{
				let follow = window.clone();
				window.on_window_event(move |event| {
					if !matches!(event, tauri::WindowEvent::Resized(_)) {
						return;
					}
					let inset = match follow.is_fullscreen() {
						Ok(true) => 0.0,
						_ => TRAFFIC_LIGHT_INSET,
					};
					let _ = follow.eval(set_inset(inset));
				});
			}

			// Lift the cap before the first frame. PlatformWebview::inner is macOS-only.
			#[cfg(target_os = "macos")]
			{
				let _ = window.with_webview(|webview| {
					if !framerate::unlock(webview.inner()) {
						eprintln!("[shell] the webview's 60 fps cap could not be lifted");
					}
				});
			}

			window.show().inspect_err(|_| server::stop(&handle))?;


			match started {
				Err(message) => {
					let _ = window.eval(failed(&message));
				}
				Ok(server) => {
					let url: tauri::Url = format!("http://127.0.0.1:{}/", server.port)
						.parse()
						.expect("a url built from a port is a url");
					let show = window.clone();
					let owner = handle.clone();
					tauri::async_runtime::spawn(async move {
						if server::wait_ready(server.port).await {
							let _ = show.navigate(url);
						} else {
							server::stop(&owner);
							let _ = show.eval(failed(&format!(
								"The server did not answer on port {} within 20 seconds.",
								server.port
							)));
						}
					});
				}
			}

			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("error while building LightningStrike")
		// Stop the separate sidecar so closing the app also stops DDP output.
		.run(|app, event| {
			if let tauri::RunEvent::Exit = event {
				server::stop(app);
			}
		});
}

/// The one line that tells the page how much room the window controls need.
fn set_inset(inset: f64) -> String {
	format!("document.documentElement.style.setProperty('--traffic-inset', '{inset}px')")
}

/// Inject shell hints before first paint to avoid shifting the traffic-light inset.
fn shell_hints(missing_tools: &[&'static str]) -> String {
	let missing = serde_json::to_string(missing_tools).unwrap_or_else(|_| "[]".into());
	format!(
		"window.__LIGHTNINGSTRIKE__ = {{ desktop: true, platform: {platform:?}, \
		 missingTools: {missing} }}; {inset};",
		platform = std::env::consts::OS,
		inset = set_inset(TRAFFIC_LIGHT_INSET),
	)
}

/// Say why nothing is going to happen, in the window rather than to a console nobody is reading.
fn failed(message: &str) -> String {
	let text = serde_json::to_string(message).unwrap_or_else(|_| "\"Unknown failure\"".into());
	format!("window.lightningstrikeFailed && window.lightningstrikeFailed({text})")
}
