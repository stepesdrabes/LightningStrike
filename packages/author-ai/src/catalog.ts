import type { EffectDef, TrackAnalysis } from '@mv/core';
import { BUILT_IN_EFFECTS, LAYER_ROLES, SLOT, SPECTRUM_BANDS } from '@mv/core';

/** One line per effect limits the catalog cost on every authoring turn. */
export function renderCatalog(effects: readonly EffectDef[] = BUILT_IN_EFFECTS): string {
	const lines: string[] = [];
	for (const role of LAYER_ROLES) {
		const inRole = effects.filter((e) => e.role === role);
		if (inRole.length === 0) continue;
		lines.push(`${role}:`);
		for (const e of inRole) {
			const params = e.params
				.filter((p) => p.key !== 'intensity')
				.map((p) => p.key)
				.join(',');
			// How hard it hits, so the model can keep to one hitter a cue: the same rating the
			// engine budgets with.
			const activity = e.taste.activity ?? 0;
			const hits = activity >= 0.8 ? '  HARD' : activity >= 0.5 ? '  STRIKE' : '';
			lines.push(
				`  ${e.id} (e${e.taste.energy}) ${e.blurb}${params ? `  [${params}]` : ''}${
					e.taste.peakReserved ? '  ONCE' : ''
				}${hits}`
			);
		}
	}
	return lines.join('\n');
}

export function renderDslReference(): string {
	return `Available inside a generated effect (no imports; everything below is already in scope):

Math and time
  clamp(v, lo=0, hi=1) · lerp(a, b, t) · frac(v) · smoothstep(e0, e1, v)
  envelope(current, target, dt, tauAttack, tauRelease) - asymmetric follower
  alphaFor(dt, tau) · lerpAngle01(a, b, t) - shortest arc on a 0..1 circle

Waveforms and noise
  sinewave(v) · triwave(v) · pulse(phase, falloff=6) - hard edge, exponential tail
  noise3(x, y, z) -> 0..1 improved Perlin

Determinism (never use Math.random; the gate rejects it)
  new Rng(seed) -> .float() .int(n) .range(lo, hi) · hash01(k) - stateless per-index

Envelopes
  new PulseEnv() -> .fire(strength) .decay(dt, beatPeriod, beats) .reset()
  new FlashEnvelope(hold, releaseTau) -> .fire(s) .update(dt) .reset()
  new Schmitt(lo, hi) -> .update(v) · ratchet(current, target, dt, riseTau)
  new Follower(attackTau = 0.025, releaseTau = 0.14) -> .update(target, f.dt) .reset()
    Fast up, slower down, in SECONDS. What anything reading f.spectrum passes through. The
    spectrum is a real 50 Hz measurement and carries a few per cent of frame-to-frame noise, so
    a value wired straight to it shimmers; a 25 ms attack is under the eye's integration window,
    so a transient still arrives looking instant while the noise averages out. Reach for this
    first: it is what makes a room look like it is listening.
  new BeatHold(glideBeats = 0.12) -> .update(target, f.beat, f.dt, f.beatPeriod) .reset()
    Read once per beat, hold, glide in beats. Quantises to the grid, which also throws away
    every stab, cymbal and word between beats, so this is for things that SHOULD only move on
    the beat - a colour the room settles into, a lobe position that should not wander. It is
    not the default answer to shimmer; Follower is.
  new Presence(holdBeats = 4, releaseBeats = 4) -> .update(f.kickEnv, f.dt, f.beatPeriod) .reset()
    Whether the instrument is currently PLAYING: 1.0 while hits keep arriving, held through a
    pattern's own gaps, gone within a couple of bars once it leaves. Scale a grid-locked pulse
    by this so it stops striking when the producer pulls the kick out - timing stays the
    grid's, only the permission to strike follows the kit. Rises to the envelope's peak, so a
    ghost note arms a ghost of a pulse.

Buffers (out is length g.count*3, RGB interleaved, persistent across frames)
  fadeToBlack(buf, dt, tau) - never clear, always decay
  nblend(dst, src, amount) · scaleBuf(buf, k) · fillSolid(buf, count, [r,g,b])
  setPixel/addPixel(buf, i, r, g, b) · addPixelF(buf, pos, n, r, g, b, wrap) - sub-pixel
  stampGaussian(buf, n, centre, sigma, r, g, b, wrap, lo, hi) - PASS lo/hi when stamping
    into the global buffer, or a blob near one strip's end bleeds onto an unrelated strip
  stampOnStrip(buf, count, strip, pos, sigma, [r,g,b]) - the same, already clipped
  blur1d(buf, n, amount, wrap)

Colour (address by slot, never by hue)
  SLOT = { ${Object.entries(SLOT)
			.map(([k, v]) => `${k}: ${v}`)
			.join(', ')} }
  sample(palette, u, brightness) -> [r,g,b] · setSample(buf, i, palette, u, brightness)
  addSample(buf, i, palette, u, brightness)
  paletteArc(u) - spread a 0..1 sweep across the lit palette, base through accent and back.
    What to reach for instead of hsv2rgb when an effect wants VARIETY rather than one colour.
    Ping-pongs, so a rotating look has no seam, and never passes through the near-black slots.

Space
  ringU(g, i) - one LED's position around the perimeter, or along the beam
  stripAxis(strip) -> 'x' | 'y' - which axis a run spans. How to tell one side of the
    frame from the pair at right angles to it; every run's normal points down, so the
    normal cannot answer this
  ringsFor(g) -> { perimeter, perimeterHalf, beam, all }; each has .map, .length, .metres
  scatter(ring, src, dst) · scatterAdd · scatterMirrored(full, half, src, dst)
  pxPerSecond(ring, metresPerSecond)
  computeU(out, g, projection, angle) with projection one of
    'perimeter' 'radial' 'height' 'sweep' 'pinwheel' 'local' 'index' 'dist'
  paint(dst, g, u, src, srcLen, add) - lay a 1-D pattern across the room via any projection
  panU(f.pan, reach=0.35) - the stereo image as a 0..1 x-coordinate. A bias, never a
    position: hard left reaches only a third of the way out, and the excursion should be
    scaled by f.panWidth so a mono passage sits centred.

Geometry (g)
  g.count · g.strips[] (id, name, offset, count, start, end, normal, inPerimeter)
  g.x/y/z (metres) · g.nx/ny/nz (0..1, one shared divisor) · g.r · g.theta · g.dist
  g.strip[i] · g.local[i] · g.perim[i] (-1 off-perimeter) · g.pitch · g.extent

Frame (ctx.f)
  t dt · beat downbeat phraseStart · beatIndex barIndex · beatPhase barPhase phrasePhase
  beatPeriod bpm · section sectionProgress buildProgress timeToDrop timeSinceDrop
  energy · bands[0..3] = sub low mid air
  spectrum - ${SPECTRUM_BANDS} log-spaced bands, 0..1, lowest first. NOT the same kind of number
    as bands[]: the bands say how LOUD, against their own range across the track, and the
    spectrum says what SHAPE, against one shared reference per band. 1.0 is as loud as this
    track's loud passages get and 0.0 is thirty decibels under it, so the relative height
    between bands is real and a drop does not arrive as a flat plateau of ones. The only field
    with enough resolution to carry a melody, and the reason a passage with no drums in it can
    still look like something. Address it through the helpers rather than by index:
      bandAt(f, u) - the level at 0 (bottom of the range) to 1 (top), interpolated. Mapping a
        pixel's own ringU straight onto u is the idiom: the room becomes an analyser.
      bandBetween(f, from, to) - mean over a slice
      spectrumPeak(f) - the loudest band right now; what to scale a meter's ceiling against
      spectralTilt(f) - where the energy is sitting, 0 low to 1 high. Says "this passage is
        bright" without saying how loud it is; 0.5 on silence. Drive a hue walk or a position
        with it and the room follows a filter opening rather than a level.
      spectrumFocus(f) - 0 when every band is level, 1 when one band has it all. What separates
        a lone sustained note from a full arrangement at the same loudness.
  pan (-1 left .. +1 right) · panWidth (0 mono .. 1 fully decorrelated)
    Where the mix is sitting across the room, from the stereo file. Use it to BIAS a position
    an effect is already choosing, multiplied by panWidth so a mono passage does not move:
    a chopped vocal flicked hard left and right every sixteenth is invisible to every other
    field here, because the sum of the two channels does not move at all.
  kick snare hat (booleans, one frame) · kickEnv snareEnv hatEnv (use these for brightness)
  level (0..1, momentary)
    How loud it is RIGHT NOW against the track's loud passages: 1.0 there, 0.0 forty-eight
    decibels under, sampled every 10 ms so a stick click and the rest after it both show.
    energy is the passage; level is this instant. Pass it through a Follower and drive
    brightness or reach with it where the kit is sparse, and let a rest go dark.

Also on ctx: g, p (your params), palette, hueShift, motion (multiply your speeds by it).`;
}

/** A monospace shape of the arrangement. Cheap, and it reads at a glance. */
export function renderArrangementChart(analysis: TrackAnalysis, width = 60): string {
	const lines: string[] = [];
	const bars = analysis.bars;
	const step = Math.max(1, Math.ceil(bars.length / width));
	const glyphs = ' .:-=+*#%@';

	lines.push('energy, one column per ' + (step === 1 ? 'bar' : `${step} bars`) + ':');
	let row = '';
	for (let i = 0; i < bars.length; i += step) {
		let peak = 0;
		for (let k = i; k < Math.min(bars.length, i + step); k++) {
			if (bars[k].energy > peak) peak = bars[k].energy;
		}
		row += glyphs[Math.min(glyphs.length - 1, Math.floor((peak / 100) * (glyphs.length - 1)))];
	}
	lines.push(`  ${row}`);

	let ruler = '';
	let labels = '';
	for (let i = 0; i < bars.length; i += step) {
		const onLabel = Math.floor(i / step) % 8 === 0;
		ruler += onLabel ? '|' : ' ';
		if (onLabel) {
			const text = String(i);
			labels += text;
			for (let k = 1; k < 8 - text.length + 1; k++) labels += ' ';
		}
	}
	lines.push(`  ${ruler}`);
	lines.push(`  ${labels.slice(0, row.length + 8)}`);

	lines.push('');
	lines.push('sections:');
	for (const s of analysis.sections) {
		lines.push(
			`  ${String(s.index).padStart(2)} ${s.kind.padEnd(10)} bars ${String(s.startBar).padStart(3)}-${String(
				s.endBar
			).padStart(3)} (${String(s.lengthBars).padStart(2)}) mean ${String(s.meanEnergy).padStart(3)} peak ${String(
				s.peakEnergy
			).padStart(3)} rank ${s.energyRank}${s.repeatOf !== null ? ` repeats §${s.repeatOf}` : ''}`
		);
	}
	return lines.join('\n');
}

export function renderBarTable(analysis: TrackAnalysis, from = 0, to = Infinity): string {
	const rows = analysis.bars.filter((b) => b.bar >= from && b.bar <= to);
	const lines = ['bar\tt\tsection\tenergy\tsub\tlow\tmid\tair\tvoc\tkicks\tsnares\thats\tevents'];
	for (const b of rows) {
		lines.push(
			[
				b.bar,
				b.t.toFixed(2),
				b.section,
				b.energy,
				b.sub,
				b.low,
				b.mid,
				b.air,
				Math.round((b.vocal ?? 0) * 100),
				b.kicks,
				b.snares,
				b.hats,
				b.events.join('|')
			].join('\t')
		);
	}
	return lines.join('\n');
}

export function renderHeader(analysis: TrackAnalysis): string {
	const t = analysis.tempo;
	const squashed =
		analysis.peakToLoudness < 8
			? '   <- heavily limited: per-bar level barely moves, so take the dynamics from onset density and arrangement rather than from energy alone'
			: '';
	return [
		`title: ${analysis.title}`,
		`trackId: ${analysis.trackId}`,
		`analysisHash: ${analysis.hash}   <- copy this into the show verbatim`,
		`duration: ${analysis.duration.toFixed(1)} s`,
		`bpm: ${t.bpm} (confidence ${t.confidence.toFixed(2)}${t.constant ? '' : ', tempo drifts: bar times in the table are the authority'})`,
		`beatsPerBar: ${t.beatsPerBar} (confidence ${t.meterConfidence.toFixed(2)})   barsPerPhrase: ${t.barsPerPhrase}   phraseAnchorBar: ${t.phraseAnchorBar}`,
		`key: ${analysis.key.name} (confidence ${analysis.key.confidence.toFixed(2)})`,
		`bars: 0-${analysis.bars.length - 1}`,
		`integratedLufs: ${analysis.integratedLufs}   loudnessRange: ${analysis.loudnessRange} LU   peakToLoudness: ${analysis.peakToLoudness} LU${squashed}`
	].join('\n');
}

export function renderMoments(analysis: TrackAnalysis): string {
	return analysis.moments
		.map((m) => `bar ${String(m.bar).padStart(3)} · ${m.kind.padEnd(14)} · ${m.note}`)
		.join('\n');
}
