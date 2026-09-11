//! HTTP over embedded-io-async, independent of Embassy and testable on the host.

#![no_std]

use embedded_io_async::{Read, Write};
use room_light::api::{InfoDto, Patch, PatchDto, StateDto};
use room_light::state::EffectKind;

/// Headers and body together; a control plane has no business with more.
const REQUEST_CAP: usize = 1024;
const BODY_CAP: usize = 512;

// Both boards run single-threaded executors, so a Send bound on the futures would only be noise.
#[allow(async_fn_in_trait)]
pub trait Api {
	fn effects(&self) -> &'static [EffectKind];
	fn info(&self) -> InfoDto<'static>;
	async fn state(&mut self) -> StateDto;
	/// Applies the patch and answers with the state that resulted.
	async fn apply(&mut self, patch: Patch) -> StateDto;
	async fn identify(&mut self);
}

/// One request, one response, connection closed; the caller owns timeouts and the socket.
pub async fn serve<C: Read + Write>(conn: &mut C, api: &mut impl Api) -> Result<(), C::Error> {
	let mut buf = [0u8; REQUEST_CAP + BODY_CAP];
	let mut len = 0usize;

	let header_end = loop {
		if let Some(end) = headers_end(&buf[..len]) {
			break end;
		}
		if len == buf.len() {
			return respond(conn, 413, "Payload Too Large", br#"{"error":"request too large"}"#)
				.await;
		}
		let n = conn.read(&mut buf[len..]).await?;
		if n == 0 {
			return Ok(());
		}
		len += n;
	};

	enum Route {
		State,
		Info,
		Identify,
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
			return respond(conn, 400, "Bad Request", br#"{"error":"bad request"}"#).await;
		}
		let route = match req.path.unwrap_or("") {
			"/api/state" => Route::State,
			"/api/info" => Route::Info,
			"/api/identify" => Route::Identify,
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

	match (method, route) {
		// Answer preflights on every path so unknown routes do not appear as unreachable origins.
		(Method::Options, _) => respond(conn, 204, "No Content", b"").await,
		(Method::Get, Route::State) => {
			let state = api.state().await;
			respond_json(conn, &state).await
		}
		(Method::Post, Route::State) => {
			let Some(length) = content_length else {
				return respond(
					conn,
					411,
					"Length Required",
					br#"{"error":"content-length required"}"#,
				)
				.await;
			};
			if length > BODY_CAP {
				return respond(conn, 413, "Payload Too Large", br#"{"error":"body too large"}"#)
					.await;
			}
			let total = header_end + length;
			while len < total {
				let n = conn.read(&mut buf[len..total]).await?;
				if n == 0 {
					return Ok(());
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
