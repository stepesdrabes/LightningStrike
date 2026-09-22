import * as THREE from 'three';
import { atlasU, atlasV, type AtlasLayout } from '../atlas.ts';
import { LIGHTING } from '../lighting.ts';
import { STRIP_FRAGMENT, STRIP_VERTEX } from '../shaders/strip.ts';
import {
	STRIP_STANDOFF,
	STRIP_THICKNESS,
	bandVertices,
	lengthOf,
	stepsOf,
	type StripPiece
} from '../strips.ts';
import { bandGeometry, perBand } from './bands.ts';

/** Every path and ring as ribbons in one mesh, each piece sampling its own atlas strip. */
export function buildRibbons(
	pieces: readonly StripPiece[],
	atlas: AtlasLayout,
	led: THREE.Texture
): THREE.Mesh | null {
	const drawn = pieces
		.map((p, i) => ({ p, slot: atlas.slots[i] }))
		.filter(({ p }) => lengthOf(p.shape) > 1e-6);
	if (drawn.length === 0) return null;

	const bands = drawn.map(({ p }) =>
		bandVertices(p.shape, p.normal, STRIP_THICKNESS, STRIP_STANDOFF, stepsOf(p))
	);
	const geometry = bandGeometry(bands);
	geometry.setAttribute(
		'strip',
		perBand(
			bands,
			4,
			drawn.map(({ p, slot }) => [
				p.count / atlas.width,
				atlasU(atlas, slot, p.count, 0),
				atlasV(atlas, slot),
				p.count
			])
		)
	);

	return new THREE.Mesh(
		geometry,
		new THREE.ShaderMaterial({
			uniforms: {
				uLed: { value: led },
				uGain: { value: LIGHTING.emitterGain }
			},
			vertexShader: STRIP_VERTEX,
			fragmentShader: STRIP_FRAGMENT,
			// Both sides, so orbiting past a wall does not make its strip vanish.
			side: THREE.DoubleSide,
			toneMapped: false
		})
	);
}
