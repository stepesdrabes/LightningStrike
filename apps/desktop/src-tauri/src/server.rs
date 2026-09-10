use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Long enough to cover a cold start where the OS is paging the runtime in, short enough that
/// a genuinely broken sidecar reports rather than hangs.
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_EVERY: Duration = Duration::from_millis(40);

/// What distinguishes a renamed copy of the app, or nothing for the original.
///
/// Read off the bundle rather than from a setting so the choice survives a double-click:
/// naming the copy is the whole of the configuration.
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

/// The running sidecar, held so that quitting can end it.
///
/// Nothing else owns it: the handle `spawn` returns kills the process on request but not on
/// drop, so letting it fall out of scope leaves a Node server that outlives the window,
/// reparented to init and still streaming DDP at the room. That is not a leaked handle, it is
/// a room that keeps lighting after the app is gone.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Start the bundled Node server. Returns as soon as the process exists, not when it answers.
///
/// The waiting is `wait_ready`, deliberately apart: this runs on the thread that owns the
/// window, and the sidecar takes seconds to come up. Doing both here is what left the app with
/// no window at all until the server was serving, which macOS reports as not responding.
///
/// The port is chosen here rather than fixed, so the app never collides with a dev server on
/// 5180 or with a second copy of itself. It binds every interface on purpose: the queue is
/// server state precisely so that phones in the room can add to it.
pub fn spawn(app: &AppHandle, path: &str) -> Result<Server, String> {
	let port = free_port()?;

	let entry = resource(app, "server/index.js")?;
	let models = resource(app, "models")?;
	// The bundle is read-only and code-signed, so everything the app writes lives beside its
	// preferences instead. `paths.ts` reads both of these.
	// Two copies of this app share one bundle identifier, so by default they share one library
	// - which makes comparing two builds impossible without wiping between them, and a
	// comparison is how every real question about the room has been settled. A copy renamed on
	// the way into /Applications gets a library of its own, so "LightningStrike (B).app" can
	// hold a different show for the same track and be judged beside the original. An inherited
	// MV_CACHE_DIR still wins, for a session driving the comparison itself.
	let cache = match std::env::var_os("MV_CACHE_DIR") {
		Some(dir) => PathBuf::from(dir),
		None => {
			// Local rather than roaming: the same directory on macOS, and on Windows the one
			// that is not synced to a domain profile. A library is gigabytes of cached audio.
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

	// The bundled ingest worker, so analysis runs off the server's main thread in the app
	// exactly as it does in dev. Optional on purpose: an older bundle without the file
	// still starts, it just ingests in-process the way it always did.
	if let Ok(worker) = resource(app, "server/ingest-worker.mjs") {
		sidecar = sidecar.env("MV_INGEST_WORKER", worker);
	}

	let (mut rx, child) = sidecar.spawn().map_err(|e| format!("cannot start server: {e}"))?;
	app.manage(Sidecar(Mutex::new(Some(child))));

	// The child outlives this function, so its output has to be drained or the pipe fills and
	// the server blocks on its own logging. Forwarded to stderr, where `tauri dev` shows it.
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

/// Wait until the sidecar answers, off the thread that owns the window.
///
/// `spawn_blocking` rather than an async sleep loop: the wait below is a blocking connect with a
/// blocking sleep between tries, and putting that on an async worker is what it is for.
pub async fn wait_ready(port: u16) -> bool {
	tauri::async_runtime::spawn_blocking(move || wait_until_listening(port))
		.await
		.unwrap_or(false)
}

/// End the sidecar. Idempotent, because both the failed-start path and the exit path call it.
///
/// The queue is written beside its file and renamed, so there is no half-written state to
/// protect here and a signal is enough.
pub fn stop(app: &AppHandle) {
	let Some(sidecar) = app.try_state::<Sidecar>() else {
		return;
	};
	let child = sidecar.0.lock().ok().and_then(|mut held| held.take());
	if let Some(child) = child {
		let _ = child.kill();
	}
}

/// A connect rather than an HTTP request: the question is only whether the listener is up,
/// and the first route to answer would need the app running anyway.
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

/// Ask the OS for a free port by binding zero, then release it.
///
/// There is a race between releasing and the server binding, which is unavoidable without
/// passing a socket to a child that expects a port number. In practice nothing else on the
/// machine is racing for an ephemeral port in that window.
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

/// Windows' verbatim `\\?\C:\...` form, back to the plain one.
///
/// Tauri resolves a resource through `canonicalize`, which on Windows always answers verbatim,
/// and Node cannot run a main module from one: it reads the prefix as a UNC share and ends up
/// calling lstat on `C:` alone. Nothing resolved here is near the length that needs the prefix.
#[cfg(windows)]
fn simplified(path: PathBuf) -> PathBuf {
	dunce::simplified(&path).to_path_buf()
}

#[cfg(not(windows))]
fn simplified(path: PathBuf) -> PathBuf {
	path
}
