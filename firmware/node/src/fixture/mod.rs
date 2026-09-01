//! What this board drives, which is the one thing the three builds differ by.
//!
//! All three expose the same surface - `KIND`, `HOSTNAME`, `PIXELS`, `IDLE_PERIOD`, `claim`,
//! `selftest`, `present`, `idle`, `idle_forever` - so nothing above this module branches on which
//! one was linked in.
//! `claim` takes the whole `Peripherals` and hands back what it did not want as a [`Board`],
//! which is what makes the pin budget a compile error rather than a comment.
//!
//! [`Board`]: crate::board::Board

#[cfg(any(
	all(feature = "frame", feature = "bounce"),
	all(feature = "frame", feature = "bench"),
	all(feature = "bounce", feature = "bench")
))]
compile_error!("one fixture per binary: build with --features frame, bounce or bench");
#[cfg(not(any(feature = "frame", feature = "bounce", feature = "bench")))]
compile_error!("no fixture selected: build with --features frame, bounce or bench");

#[cfg(feature = "bench")]
mod bench;
#[cfg(feature = "bounce")]
mod bounce;
#[cfg(feature = "frame")]
mod frame;
#[cfg(feature = "strips")]
mod rgbww;

#[cfg(feature = "bench")]
pub use bench::Fixture;
#[cfg(feature = "bounce")]
pub use bounce::Fixture;
#[cfg(feature = "frame")]
pub use frame::Fixture;
