//! What this board drives, the one thing the three builds differ by. All three expose the same
//! surface, so nothing above this module branches on which one was linked in, and `claim` hands
//! back what it did not want as a [`Board`], which makes the pin budget a compile error.
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
