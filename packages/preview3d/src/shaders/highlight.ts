export const HALO_VERTEX = /* glsl */ `
	attribute float along;
	varying vec2 vUv;
	varying float vAlong;
	void main() {
		vUv = uv;
		vAlong = along;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

/** A soft band behind a strip, with pulses running the way its data does. */
export const HALO_FRAGMENT = /* glsl */ `
	uniform vec3 uColor;
	/// How far the pulses have travelled, in pulses, 0..1.
	uniform float uPulse;
	varying vec2 vUv;
	varying float vAlong;

	/// Metres between pulses.
	const float WAVELENGTH = 0.6;

	void main() {
		float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
		float phase = fract(vAlong / WAVELENGTH - uPulse);
		// Rising slowly and dropping at its front, a pulse reads as moving toward that front.
		float pulse = 0.3 + 0.7 * phase * phase;
		gl_FragColor = vec4(uColor * (across * across * pulse), 1.0);
	}
`;

/** A panel's outline: a quad reaching past its edges, in the panel's own plane. */
export const PANEL_OUTLINE_VERTEX = /* glsl */ `
	uniform vec2 uHalf;
	uniform float uReach;
	varying vec2 vAt;
	varying vec2 vHalf;
	void main() {
		vAt = (uv * 2.0 - 1.0) * (uHalf + uReach);
		vHalf = uHalf;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

/** A lamp's outline: a camera-facing capsule round its axis, a disc when seen from above. */
export const LAMP_OUTLINE_VERTEX = /* glsl */ `
	uniform vec3 uBottom;
	uniform float uLength;
	uniform float uReach;
	varying vec2 vAt;
	varying vec2 vHalf;
	void main() {
		vec3 mid = uBottom + vec3(0.0, 0.0, uLength * 0.5);
		vec3 view = normalize(cameraPosition - mid);
		vec3 axis = vec3(0.0, 0.0, 1.0) - view * view.z;
		float shown = length(axis);
		vec3 other = abs(view.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
		axis = shown > 1e-3 ? axis / shown : normalize(cross(view, other));
		vec3 side = cross(axis, view);
		vHalf = vec2(0.0, uLength * 0.5 * shown);
		vAt = position.xy * (vHalf + uReach);
		vec3 world = mid + side * vAt.x + axis * vAt.y;
		gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
	}
`;

/** Glow falling off with distance from a rectangle, rounded out to a radius. */
export const OUTLINE_FRAGMENT = /* glsl */ `
	uniform vec3 uColor;
	/// Metres from the rectangle to the silhouette, which covers the glow inside it.
	uniform float uRadius;
	uniform float uReach;
	varying vec2 vAt;
	varying vec2 vHalf;

	void main() {
		float d = length(max(abs(vAt) - vHalf, 0.0));
		float inside = uRadius > 0.0 ? smoothstep(uRadius * 0.6, uRadius, d) : 1.0;
		float glow = inside * (1.0 - smoothstep(uRadius, uReach, d));
		gl_FragColor = vec4(uColor * glow, 1.0);
	}
`;
