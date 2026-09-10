#[cfg(not(windows))]
use std::io::Read;
#[cfg(not(windows))]
use std::process::{Command, Stdio};
#[cfg(not(windows))]
use std::time::{Duration, Instant};

/// How long the login shell gets to answer.
///
/// `-i` sources the user's whole rc file, which on a well-loved machine means a version manager,
/// a completion system and whatever else has accumulated. Usually a few hundred milliseconds,
/// occasionally seconds, and if it prompts or blocks on a network mount it never returns at all -
/// so this waits with a deadline and falls back to the standard directories rather than trusting
/// somebody else's shell configuration with the app's startup.
#[cfg(not(windows))]
const SHELL_TIMEOUT: Duration = Duration::from_millis(1500);

/// Where Homebrew puts things, on both architectures, plus the standard system directories.
#[cfg(not(windows))]
const FALLBACKS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

/// What separates one directory from the next in a PATH.
#[cfg(windows)]
const SEPARATOR: char = ';';
#[cfg(not(windows))]
const SEPARATOR: char = ':';

/// What a runnable name on PATH may end in. Windows keeps the extension; Unix has none.
#[cfg(windows)]
const EXTENSIONS: &[&str] = &[".exe", ".cmd", ".bat", ".com"];
#[cfg(not(windows))]
const EXTENSIONS: &[&str] = &[""];

/// The tools the analysis pipeline shells out to. Missing ones are named at startup rather
/// than surfacing later as a failed ingest with a message about a missing binary.
pub const REQUIRED_TOOLS: &[&str] = &["ffmpeg", "ffprobe", "yt-dlp"];

/// The PATH the sidecar should run with.
///
/// An app launched from Finder inherits a minimal PATH that contains neither Homebrew
/// directory, so `ffmpeg` and `yt-dlp` are invisible to it however carefully they were
/// installed. Asking the user's login shell is the only way to get the PATH they actually
/// have; the fallbacks cover the case where that fails or the shell is not configured.
#[cfg(not(windows))]
pub fn resolve_path() -> String {
	let mut parts: Vec<String> = login_shell_path()
		.map(|p| p.split(':').map(str::to_owned).collect())
		.unwrap_or_default();

	for dir in FALLBACKS {
		if !parts.iter().any(|p| p == dir) {
			parts.push((*dir).to_owned());
		}
	}

	parts.join(":")
}

/// Windows hands a GUI app the user's own PATH already, so there is nothing to recover.
#[cfg(windows)]
pub fn resolve_path() -> String {
	std::env::var_os("PATH")
		.map(|p| p.to_string_lossy().into_owned())
		.unwrap_or_default()
}

/// `-ilc` so login and rc files both run, which is where a PATH edit usually lives.
#[cfg(not(windows))]
fn login_shell_path() -> Option<String> {
	let shell = std::env::var("SHELL").ok()?;
	let mut child = Command::new(shell)
		.args(["-ilc", "printf %s \"$PATH\""])
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::null())
		.spawn()
		.ok()?;

	// `output()` would wait forever, which is the one thing this must not do. Polling is crude
	// but it is the whole of the timeout: there is no portable wait-with-deadline.
	let deadline = Instant::now() + SHELL_TIMEOUT;
	loop {
		match child.try_wait() {
			Ok(Some(status)) if status.success() => break,
			Ok(Some(_)) | Err(_) => return None,
			Ok(None) => {}
		}
		if Instant::now() >= deadline {
			let _ = child.kill();
			let _ = child.wait();
			return None;
		}
		std::thread::sleep(Duration::from_millis(10));
	}

	// Read after waiting, which is only safe because a PATH is a few hundred bytes: a child
	// writing more than the pipe holds would block forever waiting for someone to drain it.
	let mut path = String::new();
	child.stdout.take()?.read_to_string(&mut path).ok()?;
	let trimmed = path.trim();
	(!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Which of the required tools cannot be found on the given PATH.
pub fn missing_tools(path: &str) -> Vec<&'static str> {
	REQUIRED_TOOLS
		.iter()
		.copied()
		.filter(|tool| !on_path(path, tool))
		.collect()
}

fn on_path(path: &str, tool: &str) -> bool {
	path.split(SEPARATOR).filter(|d| !d.is_empty()).any(|dir| {
		let dir = std::path::Path::new(dir);
		// Existence rather than the executable bit: a file of that name on PATH that cannot be
		// run is a broken install, and saying "not found" about it would send the user looking
		// in the wrong place.
		EXTENSIONS.iter().any(|ext| dir.join(format!("{tool}{ext}")).is_file())
	})
}
