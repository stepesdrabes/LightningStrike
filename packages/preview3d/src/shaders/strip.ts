export const STRIP_VERTEX = /* glsl */ `
	varying vec2 vUv;
	varying float vDist;
	void main() {
		vUv = uv;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vDist = -mv.z;
		gl_Position = projectionMatrix * mv;
	}
`;

/**
 * Blend from discrete emitter texels up close to the linear-filtered diffuser at room
 * distance.
 */
export const STRIP_FRAGMENT = /* glsl */ `
	uniform sampler2D uLed;
	uniform float uUScale;
	uniform float uUOffset;
	uniform float uRow;
	uniform float uCount;
	uniform float uGain;
	varying vec2 vUv;
	varying float vDist;

	void main() {
		vec3 frosted = texture2D(uLed, vec2(vUv.x * uUScale + uUOffset, uRow)).rgb;

		float cell = vUv.x * uCount;
		float centre = (floor(cell) + 0.5) / uCount;
		vec3 led = texture2D(uLed, vec2(centre * uUScale + uUOffset, uRow)).rgb;
		float dx = fract(cell) - 0.5;
		float dy = vUv.y - 0.5;
		float emitter = exp(-dx * dx * 22.0 - dy * dy * 9.0);
		vec3 dotted = led * (0.22 + 1.35 * emitter);

		float near = 1.0 - smoothstep(1.1, 3.2, vDist);
		vec3 c = mix(frosted, dotted, near);

		// Softened across the short axis so it reads as a diffuser channel, not a sticker.
		float core = smoothstep(0.0, 0.42, vUv.y) * smoothstep(1.0, 0.58, vUv.y);
		gl_FragColor = vec4(c * uGain * (0.5 + 0.6 * core), 1.0);
	}
`;
