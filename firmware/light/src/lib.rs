//! The light itself, apart from any board: colour maths and the standalone effects. Imports
//! nothing from Embassy and nothing chip-specific, so it builds and tests on the host.

#![no_std]

pub mod api;
pub mod colour;
pub mod effects;
pub mod engine;
pub mod settings;
pub mod state;
