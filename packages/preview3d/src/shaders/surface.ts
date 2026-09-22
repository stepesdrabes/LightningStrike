export const SURFACE_VERTEX = /* glsl */ `
	varying vec3 vWorld;
	varying vec3 vNormal3;
	void main() {
		vec4 world = modelMatrix * vec4(position, 1.0);
		vWorld = world.xyz;
		vNormal3 = normalize(mat3(modelMatrix) * normal);
		gl_Position = projectionMatrix * viewMatrix * world;
	}
`;

/**
 * Integrate each line light using cos(emitter) * cos(surface) / distance squared, and each point
 * the same way softened over its own size. Clamped emitter cosines keep what is behind a light
 * dark; a point with no normal is a diffuse lamp and throws all round.
 */
export function surfaceFragment(lines: number, samples: number, points: number): string {
	return /* glsl */ `
	#define LINES ${lines}
	// Eight is where the pool stops changing shape on a 3 m run seen from a metre away; the
	// samples cost a texture fetch each, so a room of many lines takes fewer per line.
	#define SAMPLES ${samples}
	#define POINTS ${points}

	uniform sampler2D uLed;
	#if LINES > 0
	uniform vec4 uLine[LINES * 3];
	#endif
	#if POINTS > 0
	uniform vec4 uPoint[POINTS * 2];
	uniform vec3 uPointColor[POINTS];
	#endif
	uniform int uSelf;
	uniform float uLineGain;
	uniform float uReflect;
	uniform float uAmbientMix;
	uniform vec3 uAmbient;
	uniform vec3 uBase;
	uniform vec3 uGlow;
	uniform float uEmitGain;
	varying vec3 vWorld;
	varying vec3 vNormal3;

	/// A surface passing through an emitter must not divide by nothing.
	const float SOFT = 0.02;

	void main() {
		vec3 n = normalize(vNormal3);
		vec3 lit = vec3(0.0);

	#if LINES > 0
		vec3 fromLines = vec3(0.0);
		for (int i = 0; i < LINES; i++) {
			vec4 a = uLine[i * 3];
			vec4 b = uLine[i * 3 + 1];
			vec4 e = uLine[i * 3 + 2];
			vec3 ab = b.xyz - a.xyz;
			float dl = length(ab) / float(SAMPLES);

			for (int k = 0; k < SAMPLES; k++) {
				float t = (float(k) + 0.5) / float(SAMPLES);
				vec3 toLed = a.xyz + ab * t - vWorld;
				float d2 = dot(toLed, toLed) + SOFT;
				float d = sqrt(d2);
				float emit = max(-dot(e.xyz, toLed) / d, 0.0);
				float face = max(dot(n, toLed) / d, 0.0);
				vec3 led = texture2D(uLed, vec2(a.w + t * b.w, e.w)).rgb;
				fromLines += led * (emit * face * dl / d2);
			}
		}
		lit += fromLines * uLineGain;
	#endif

	#if POINTS > 0
		vec3 fromPoints = vec3(0.0);
		for (int i = 0; i < POINTS; i++) {
			if (i == uSelf) continue;
			vec4 p = uPoint[i * 2];
			vec4 q = uPoint[i * 2 + 1];
			vec3 toPoint = p.xyz - vWorld;
			float d2 = dot(toPoint, toPoint) + p.w;
			float inv = inversesqrt(d2);
			float face = max(dot(n, toPoint) * inv, 0.0);
			float emit = dot(q.xyz, q.xyz) > 0.5 ? max(-dot(q.xyz, toPoint) * inv, 0.0) : 1.0;
			fromPoints += uPointColor[i] * (q.w * face * emit / d2);
		}
		lit += fromPoints * uReflect;
	#endif

		// A diffuser is brightest looked at square on and falls toward its silhouette, which is
		// what stops a cylinder reading as a flat painted rectangle. Zero for everything else.
		float head = max(dot(n, normalize(cameraPosition - vWorld)), 0.0);
		vec3 glow = uGlow * (uEmitGain * (0.55 + 0.45 * head));

		gl_FragColor = vec4(uBase + uAmbient * uAmbientMix + lit + glow, 1.0);
	}
`;
}
