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

/// Where the controls start, and how much room they need.
///
/// macOS puts them near the top of a 28pt title bar; this bar is twice that, so left alone they
/// ride high above the wordmark beside them.
///
/// `y` is not the button's top edge, which is what makes this a number rather than a formula.
/// tao resizes the title bar container to `button height + y` and moves only each button's x,
/// leaving them wherever AppKit had laid them out inside it - so they end up higher than `y` by
/// however much padding that container carries, and nothing publishes that figure. Set by eye
/// against the 56pt bar, so that the circles sit on the same line as the wordmark beside them.
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

			// Both of these are bounded and quick, and the initialization script needs the second
			// one before the window exists. Everything slow happens after the window is on screen.
			let path = env::resolve_path();
			let missing = env::missing_tools(&path);
			let started = server::spawn(&handle, &path);

			// The splash, not the server: a window the user can see comes first, and the sidecar
			// is navigated to when it answers.
			// Only the macOS block below reassigns it.
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
				// Overlay puts the page under the title bar; without hiding the title as well,
				// the window's own name is drawn straight through the app's top bar.
				builder = builder
					.title_bar_style(TitleBarStyle::Overlay)
					.hidden_title(true)
					.traffic_light_position(LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y));
			}

			// A failure from here on aborts the process before `RunEvent::Exit` can run, so the
			// sidecar has to be ended on the way out or it survives an app that never opened.
			let window = builder.build().inspect_err(|_| server::stop(&handle))?;

			// Fullscreen takes the controls away, so the bar should stop holding a gap for them.
			// Pushed as a custom property rather than an event the page subscribes to: this is
			// one number the shell knows and the page only ever reads.
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

			// Before anything is drawn in it, so the first frame is already at the display's rate.
			// WKWebView is the only one that needs asking; `PlatformWebview::inner` is its own
			// accessor and does not exist elsewhere.
			#[cfg(target_os = "macos")]
			{
				let _ = window.with_webview(|webview| {
					if !framerate::unlock(webview.inner()) {
						eprintln!("[shell] the webview's 60 fps cap could not be lifted");
					}
				});
			}

			window.show().inspect_err(|_| server::stop(&handle))?;

			// From here nothing blocks the run loop. The window is up, so a slow start reads as a
			// slow start and a failed one has somewhere to say so.
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
		// The sidecar is a separate process and does not go away on its own. Without this the
		// server survives the window that started it, keeps its DDP loop running and carries on
		// lighting the room, and the next launch starts a second one beside it.
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

/// Hand the page what only the shell knows, before any of its own script runs.
///
/// A global rather than an IPC call so the first paint already has it: the top bar has to
/// reserve space for the traffic lights on the very first frame, and a round trip would show
/// the layout moving.
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
