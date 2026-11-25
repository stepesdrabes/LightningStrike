export const PANEL_VERTEX = /* glsl */ `
	varying vec2 vUv;
	varying float vDist;
	void main() {
		vUv = uv;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vDist = -mv.z;
		gl_Position = projectionMatrix * mv;
	}
`;

/** The strip's diffuser in two dimensions: dots up close, the frosted grid at distance. */
export const PANEL_FRAGMENT = /* glsl */ `
	uniform sampler2D uPanel;
	uniform vec2 uCells;
	/// The strip's dot distances scale with the pitch, so a coarse panel stays dotted farther out.
	uniform float uNear;
	uniform float uGain;
	varying vec2 vUv;
	varying float vDist;

	void main() {
		vec3 frosted = texture2D(uPanel, vUv).rgb;

		vec2 cell = vUv * uCells;
		// The base level: a cell centre jumps at every cell edge, which would pick a blurred mip.
		vec3 led = textureLod(uPanel, (floor(cell) + 0.5) / uCells, 0.0).rgb;
		vec2 d = fract(cell) - 0.5;
		float emitter = exp(-dot(d, d) * 22.0);
		vec3 dotted = led * (0.22 + 1.35 * emitter);

		float near = 1.0 - smoothstep(1.1 * uNear, 3.2 * uNear, vDist);
		gl_FragColor = vec4(mix(frosted, dotted, near) * uGain, 1.0);
	}
`;
