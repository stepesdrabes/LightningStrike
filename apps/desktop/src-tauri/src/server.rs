use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Allow cold runtime startup while bounding failures.
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_EVERY: Duration = Duration::from_millis(40);

/// Use the bundle name to isolate renamed app copies without additional configuration.
fn bundle_suffix() -> Option<String> {
	let exe = std::env::current_exe().ok()?;
	let bundle = exe
		.ancestors()
		.find(|p| p.extension().is_some_and(|e| e == "app"))?;
	let stem = bundle.file_stem()?.to_str()?;
	let rest = stem.strip_prefix("LightningStrike")?;
	let cleaned: String = rest.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
	(!cleaned.is_empty()).then_some(cleaned)
}

pub struct Server {
	pub port: u16,
}

/// Retain the sidecar handle for explicit shutdown; dropping it leaves Node and DDP running.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Spawn without waiting on the window thread. Use a free port to avoid other instances and bind
/// the LAN for phone guests.
pub fn spawn(app: &AppHandle, path: &str) -> Result<Server, String> {
	let port = free_port()?;

	let entry = resource(app, "server/index.js")?;
	let models = resource(app, "models")?;
	// Keep writable data outside the signed bundle. Renamed app copies get separate libraries; an
	// inherited MV_CACHE_DIR still wins.
	let cache = match std::env::var_os("MV_CACHE_DIR") {
		Some(dir) => PathBuf::from(dir),
		None => {
			// Use local storage on Windows so cached audio does not roam with a domain profile.
			let data = app
				.path()
				.app_local_data_dir()
				.map_err(|e| format!("no data directory: {e}"))?;
			match bundle_suffix() {
				Some(name) => data.join(format!("cache-{name}")),
				None => data.join("cache"),
			}
		}
	};
	std::fs::create_dir_all(&cache).map_err(|e| format!("cannot create {cache:?}: {e}"))?;

	let mut sidecar = app
		.shell()
		.sidecar("node")
		.map_err(|e| format!("no bundled node: {e}"))?
		.arg(entry)
		.env("PORT", port.to_string())
		.env("HOST", "0.0.0.0")
		.env("PATH", path)
		.env("MV_CACHE_DIR", cache)
		.env("MV_MODEL_DIR", models)
		.env("NODE_ENV", "production");

	// Use the bundled worker when present; older bundles retain in-process ingest.
	if let Ok(worker) = resource(app, "server/ingest-worker.mjs") {
		sidecar = sidecar.env("MV_INGEST_WORKER", worker);
	}

	let (mut rx, child) = sidecar.spawn().map_err(|e| format!("cannot start server: {e}"))?;
	app.manage(Sidecar(Mutex::new(Some(child))));

	// Drain child output to prevent logging from filling the pipe and blocking the server.
	tauri::async_runtime::spawn(async move {
		while let Some(event) = rx.recv().await {
			match event {
				CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
					eprintln!("[server] {}", String::from_utf8_lossy(&line).trim_end());
				}
				CommandEvent::Terminated(status) => {
					eprintln!("[server] exited: {status:?}");
					break;
				}
				_ => {}
			}
		}
	});

	Ok(Server { port })
}

/// Run blocking connect/retry work off the window thread.
pub async fn wait_ready(port: u16) -> bool {
	tauri::async_runtime::spawn_blocking(move || wait_until_listening(port))
		.await
		.unwrap_or(false)
}

/// Both failed startup and normal exit call this; queue writes use atomic rename.
pub fn stop(app: &AppHandle) {
	let Some(sidecar) = app.try_state::<Sidecar>() else {
		return;
	};
	let child = sidecar.0.lock().ok().and_then(|mut held| held.take());
	if let Some(child) = child {
		let _ = child.kill();
	}
}

/// A TCP connection suffices to check whether the sidecar is listening.
fn wait_until_listening(port: u16) -> bool {
	let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
	let deadline = Instant::now() + READY_TIMEOUT;
	while Instant::now() < deadline {
		if TcpStream::connect_timeout(&addr.into(), POLL_EVERY).is_ok() {
			return true;
		}
		std::thread::sleep(POLL_EVERY);
	}
	false
}

/// Binding port zero finds a free port; releasing it before Node binds leaves an unavoidable race.
fn free_port() -> Result<u16, String> {
	TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
		.and_then(|l| l.local_addr())
		.map(|a| a.port())
		.map_err(|e| format!("no free port: {e}"))
}

fn resource(app: &AppHandle, rel: &str) -> Result<std::path::PathBuf, String> {
	let path = app
		.path()
		.resolve(rel, BaseDirectory::Resource)
		.map_err(|e| format!("missing bundled {rel}: {e}"))?;
	if !Path::new(&path).exists() {
		return Err(format!("missing bundled {rel} at {path:?}"));
	}
	Ok(simplified(path))
}

/// Strip Windows verbatim-path prefixes: Node misreads them as UNC shares for main modules.
#[cfg(windows)]
fn simplified(path: PathBuf) -> PathBuf {
	dunce::simplified(&path).to_path_buf()
}

#[cfg(not(windows))]
fn simplified(path: PathBuf) -> PathBuf {
	path
}
