import { SECTION_FEATURE_COUNT } from './sectionFeatures.ts';

/**
 * Generated groove/drop weights, fitted on 115 Harmonix tracks. Do not hand-edit: coefficients
 * follow SECTION_FEATURES order. Its fitter is absent; feature changes require a new fit.
 * Other labels retain positional, kit, and silence rules.
 */

/** Weights for [groove, drop]. */
const WEIGHTS: number[][] = [[0.137389,-0.021618,0.563838,0.326735,0.296394,-1.318146,-0.752867,-0.255016,0.316522,0.152933,-0.26824,0.198146,0.060038,0.031553,0.28596,0.955025,-0.482756,0.192189,-0.100297,0.463377,-0.367495,-0.303928,0.062604,0.047672,0.942292,0.11039,-0.204744,0.270395,-0.45029,-0.067219,-0.267529,0.219281],[-0.226219,0.060486,-0.649792,-0.430396,-0.3008,1.30712,0.705468,0.268098,-0.128273,-0.189106,0.175871,-0.302708,0.13575,-0.067098,-0.312269,-0.998308,0.510278,-0.017642,0.114815,-0.543185,0.31616,0.322268,-0.100571,0.010294,-1.047366,-0.093321,0.193473,-0.227065,0.427941,0.002811,0.319744,-0.005533]];

const BIAS: number[] = [0.319718,-0.319718];

if (WEIGHTS[0].length !== SECTION_FEATURE_COUNT) {
	throw new Error(
		'section model has ' + WEIGHTS[0].length + ' weights for ' + SECTION_FEATURE_COUNT + ' features; refit it'
	);
}

/** Signed drop margin for pooling repeat evidence before committing to a label. */
export function dropMargin(x: readonly number[]): number {
	let z = BIAS[1] - BIAS[0];
	for (let d = 0; d < SECTION_FEATURE_COUNT; d++) z += (WEIGHTS[1][d] - WEIGHTS[0][d]) * x[d];
	return z;
}

