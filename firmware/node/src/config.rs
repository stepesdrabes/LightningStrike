/// What WLED listens on, and therefore what the host sends to with no configuration.
pub const DDP_PORT: u16 = 4048;

/// Once-per-second telemetry port: nc -lu 4049.
pub const STATS_PORT: u16 = 4049;

/// The light's own control plane, so a phone needs nothing but the address.
pub const HTTP_PORT: u16 = 80;
