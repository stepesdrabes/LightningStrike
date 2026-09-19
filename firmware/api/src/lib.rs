//! HTTP over embedded-io-async, independent of Embassy and testable on the host.

#![no_std]

use embedded_io_async::{Read, Write};
use room_light::api::{InfoDto, Patch, PatchDto, StateDto};
use room_light::state::EffectKind;

/// Headers and body together; a control plane has no business with more.
const REQUEST_CAP: usize = 1024;
const BODY_CAP: usize = 512;

/// Why a firmware upload was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OtaError {
	/// This board has nowhere to stage an image.
	Unsupported,
	/// Another upload already holds the slot.
	Busy,
	/// A write or commit arrived with no upload in flight.
	OutOfOrder,
	/// The request declared no image at all.
	Empty,
	/// The image does not fit the spare slot.
	TooLarge,
	/// The running firmware has not confirmed itself, so the slot an upload would overwrite is
	/// still the only way back to a firmware known to work.
	Unconfirmed,
	/// The connection ended before the whole image arrived.
	Truncated,
	/// Flash refused a write.
	Flash,
}

/// What the caller must do once the response is on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Served {
	Done,
	/// A firmware image is staged and boots on the next reset.
	Reboot,
}

// Both boards run single-threaded executors, so a Send bound on the futures would only be noise.
#[allow(async_fn_in_trait)]
pub trait Api {
	fn effects(&self) -> &'static [EffectKind];
	fn info(&self) -> InfoDto<'_>;
	async fn state(&mut self) -> StateDto;
	/// Applies the patch and answers with the state that resulted.
	async fn apply(&mut self, patch: Patch) -> StateDto;
	async fn identify(&mut self);

	/// Largest image the spare slot takes, or None on a board with only one slot. The rest of
	/// the `ota_` methods are reached only when this is Some.
	fn ota_capacity(&self) -> Option<usize> {
		None
	}

	/// Claims the slot for an image of `len` bytes, discarding whatever it held.
	async fn ota_begin(&mut self, _len: usize) -> Result<(), OtaError> {
		Err(OtaError::Unsupported)
	}

	/// Appends the next bytes; their order is the only thing that fixes their offset.
	async fn ota_write(&mut self, _chunk: &[u8]) -> Result<(), OtaError> {
		Err(OtaError::Unsupported)
	}

	/// Marks the staged image bootable. The board keeps running the old one until it resets.
	async fn ota_commit(&mut self) -> Result<(), OtaError> {
		Err(OtaError::Unsupported)
	}

	/// Releases the slot after a refused or abandoned upload. Safe to call with no upload in
	/// flight, because every failure path runs it.
	async fn ota_abort(&mut self) {}
}

/// One request, one response, connection closed; the caller owns timeouts and the socket.
/// The returned [`Served`] says whether the caller still has to reboot into a staged image.
pub async fn serve<C: Read + Write>(conn: &mut C, api: &mut impl Api) -> Result<Served, C::Error> {
	let mut buf = [0u8; REQUEST_CAP + BODY_CAP];
	let mut len = 0usize;

	let header_end = loop {
		if let Some(end) = headers_end(&buf[..len]) {
			break end;
		}
		if len == buf.len() {
			respond(conn, 413, "Payload Too Large", br#"{"error":"request too large"}"#).await?;
			return Ok(Served::Done);
		}
		let n = conn.read(&mut buf[len..]).await?;
		if n == 0 {
			return Ok(Served::Done);
		}
		len += n;
	};

	enum Route {
		State,
		Info,
		Identify,
		Ota,
		None,
	}

	enum Method {
		Get,
		Post,
		Options,
		Other,
	}

	let (method, route, content_length) = {
		let mut headers = [httparse::EMPTY_HEADER; 16];
		let mut req = httparse::Request::new(&mut headers);
		if !matches!(req.parse(&buf[..header_end]), Ok(httparse::Status::Complete(_))) {
			respond(conn, 400, "Bad Request", br#"{"error":"bad request"}"#).await?;
			return Ok(Served::Done);
		}
		let route = match req.path.unwrap_or("") {
			"/api/state" => Route::State,
			"/api/info" => Route::Info,
			"/api/identify" => Route::Identify,
			"/api/ota" => Route::Ota,
			_ => Route::None,
		};
		let method = match req.method {
			Some("GET") => Method::Get,
			Some("POST") => Method::Post,
			Some("OPTIONS") => Method::Options,
			_ => Method::Other,
		};
		let length = req
			.headers
			.iter()
			.find(|h| h.name.eq_ignore_ascii_case("content-length"))
			.and_then(|h| core::str::from_utf8(h.value).ok()?.trim().parse::<usize>().ok());
		(method, route, length)
	};

	if matches!(method, Method::Post) && matches!(route, Route::Ota) {
		return serve_ota(conn, api, &mut buf, header_end, len, content_length).await;
	}

	match (method, route) {
		// Answer preflights on every path so unknown routes do not appear as unreachable origins.
		(Method::Options, _) => respond(conn, 204, "No Content", b"").await,
		(Method::Get, Route::State) => {
			let state = api.state().await;
			respond_json(conn, &state).await
		}
		(Method::Post, Route::State) => {
			let Some(length) = content_length else {
				respond(conn, 411, "Length Required", br#"{"error":"content-length required"}"#)
					.await?;
				return Ok(Served::Done);
			};
			if length > BODY_CAP || header_end + length > buf.len() {
				respond(conn, 413, "Payload Too Large", br#"{"error":"body too large"}"#).await?;
				return Ok(Served::Done);
			}
			let total = header_end + length;
			while len < total {
				let n = conn.read(&mut buf[len..total]).await?;
				if n == 0 {
					return Ok(Served::Done);
				}
				len += n;
			}
			let patch = serde_json_core::from_slice::<PatchDto>(&buf[header_end..total])
				.map_err(|_| "body json")
				.and_then(|(dto, _)| dto.validate(api.effects()));
			match patch {
				Ok(p) => {
					let state = api.apply(p).await;
					respond_json(conn, &state).await
				}
				Err(msg) => respond_error(conn, msg).await,
			}
		}
		(Method::Get, Route::Info) => {
			let info = api.info();
			respond_json(conn, &info).await
		}
		(Method::Post, Route::Identify) => {
			api.identify().await;
			respond(conn, 204, "No Content", b"").await
		}
		(_, Route::None) => respond(conn, 404, "Not Found", br#"{"error":"not found"}"#).await,
		_ => respond(conn, 405, "Method Not Allowed", br#"{"error":"method not allowed"}"#).await,
	}
	.map(|()| Served::Done)
}

/// Streams a firmware image into the spare slot, so it never has to fit in RAM.
///
/// The slot changes hands when `ota_begin` returns, and from there every exit releases it, so
/// one abandoned upload cannot lock out the next. Refusals before that point must not touch it:
/// the slot they would release belongs to somebody else's upload.
async fn serve_ota<C: Read + Write>(
	conn: &mut C,
	api: &mut impl Api,
	buf: &mut [u8],
	header_end: usize,
	have: usize,
	content_length: Option<usize>,
) -> Result<Served, C::Error> {
	let Some(length) = content_length else {
		respond(conn, 411, "Length Required", br#"{"error":"content-length required"}"#).await?;
		return Ok(Served::Done);
	};

	if let Err(err) = claim(api, length).await {
		return refuse(conn, err).await;
	}

	match transfer(conn, api, buf, header_end, have, length).await {
		Ok(Ok(())) => {
			respond(conn, 200, "OK", br#"{"staged":true}"#).await?;
			Ok(Served::Reboot)
		}
		Ok(Err(err)) => {
			api.ota_abort().await;
			refuse(conn, err).await
		}
		Err(err) => {
			api.ota_abort().await;
			Err(err)
		}
	}
}

/// Everything that can refuse an upload while the slot is still somebody else's.
async fn claim(api: &mut impl Api, length: usize) -> Result<(), OtaError> {
	let Some(capacity) = api.ota_capacity() else {
		return Err(OtaError::Unsupported);
	};
	if length == 0 {
		return Err(OtaError::Empty);
	}
	if length > capacity {
		return Err(OtaError::TooLarge);
	}
	api.ota_begin(length).await
}

/// The transfer itself. The outer result is the connection, the inner one the slot.
async fn transfer<C: Read + Write>(
	conn: &mut C,
	api: &mut impl Api,
	buf: &mut [u8],
	header_end: usize,
	have: usize,
	length: usize,
) -> Result<Result<(), OtaError>, C::Error> {
	// Whatever of the image arrived in the same read as the headers.
	let head = have.min(header_end + length);
	let mut written = head - header_end;
	if let Err(err) = api.ota_write(&buf[header_end..head]).await {
		return Ok(Err(err));
	}

	while written < length {
		// Never read past the declared length: anything after it belongs to no image.
		let want = (length - written).min(buf.len());
		let n = conn.read(&mut buf[..want]).await?;
		if n == 0 {
			return Ok(Err(OtaError::Truncated));
		}
		if let Err(err) = api.ota_write(&buf[..n]).await {
			return Ok(Err(err));
		}
		written += n;
	}

	Ok(api.ota_commit().await)
}

/// A conflict is worth retrying in a moment; the rest need the caller to change something.
async fn refuse<C: Write>(conn: &mut C, err: OtaError) -> Result<Served, C::Error> {
	let (status, reason, body): (u16, &str, &[u8]) = match err {
		OtaError::Unsupported => (501, "Not Implemented", br#"{"error":"no spare slot"}"#),
		OtaError::Busy => (409, "Conflict", br#"{"error":"an upload is already in flight"}"#),
		OtaError::OutOfOrder => (409, "Conflict", br#"{"error":"no upload in flight"}"#),
		OtaError::Empty => (400, "Bad Request", br#"{"error":"empty image"}"#),
		OtaError::TooLarge => (413, "Payload Too Large", br#"{"error":"image does not fit"}"#),
		OtaError::Unconfirmed => {
			(409, "Conflict", br#"{"error":"running firmware is unconfirmed"}"#)
		}
		OtaError::Truncated => (400, "Bad Request", br#"{"error":"upload ended early"}"#),
		OtaError::Flash => (500, "Internal Server Error", br#"{"error":"flash write failed"}"#),
	};
	respond(conn, status, reason, body).await?;
	Ok(Served::Done)
}

fn headers_end(buf: &[u8]) -> Option<usize> {
	buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

async fn respond_json<C: Write>(
	conn: &mut C,
	value: &impl serde::Serialize,
) -> Result<(), C::Error> {
	let mut body = [0u8; 384];
	match serde_json_core::to_slice(value, &mut body) {
		Ok(n) => respond(conn, 200, "OK", &body[..n]).await,
		Err(_) => respond(conn, 500, "Internal Server Error", br#"{"error":"response"}"#).await,
	}
}

async fn respond_error<C: Write>(conn: &mut C, msg: &str) -> Result<(), C::Error> {
	let mut body = heapless::String::<96>::new();
	let _ = core::fmt::write(&mut body, format_args!(r#"{{"error":"{msg}"}}"#));
	respond(conn, 400, "Bad Request", body.as_bytes()).await
}

/// Every response needs CORS because the controller uses another origin. HEAD_CAP must fit
/// the longest header: core::fmt overflow in the fixed buffer is silent.
async fn respond<C: Write>(
	conn: &mut C,
	status: u16,
	reason: &str,
	body: &[u8],
) -> Result<(), C::Error> {
	const HEAD_CAP: usize = 320;

	let mut head = heapless::String::<HEAD_CAP>::new();
	let _ = core::fmt::write(
		&mut head,
		format_args!(
			"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\n\r\n",
			body.len()
		),
	);
	conn.write_all(head.as_bytes()).await?;
	if !body.is_empty() {
		conn.write_all(body).await?;
	}
	conn.flush().await
}

#[cfg(test)]
mod tests;
