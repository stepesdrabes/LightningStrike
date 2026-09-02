//! What this board drives, the one thing the two builds differ by. Both expose the same
//! surface, so nothing above this module branches on which one was linked in, and `claim` hands
//! back what it did not want as a [`Board`], which makes the pin budget a compile error.
//!
//! [`Board`]: crate::board::Board

#[cfg(all(feature = "frame", feature = "bench"))]
compile_error!("one fixture per binary: build with --features frame or bench");
#[cfg(not(any(feature = "frame", feature = "bench")))]
compile_error!("no fixture selected: build with --features frame or bench");

#[cfg(feature = "bench")]
mod bench;
#[cfg(feature = "frame")]
mod frame;
#[cfg(feature = "strips")]
mod rgbww;

#[cfg(feature = "bench")]
pub use bench::Fixture;
#[cfg(feature = "frame")]
pub use frame::Fixture;
