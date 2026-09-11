/**
 * Field and trail examples teach buffer ownership and palette use; examples.test.ts gates
 * both.
 */
interface WorkedExample {
	id: string;
	role: 'bed' | 'rhythm' | 'transient' | 'accent' | 'master';
	blurb: string;
	source: string;
}

const FIELD = `function create(g) {
  // Latched on the beat. f.energy is beat-resolution data the player interpolates per frame, so
  // a brightness multiplied by it slides continuously; through a BeatHold it steps on the beat.
  const level = new BeatHold(0.45);
  const lean = new BeatHold(0.3);
  return {
    reset() { level.reset(); lean.reset(); },
    render(out, ctx) {
      const { f, p, palette, hueShift, motion } = ctx;
      // Eased both ways rather than a sawtooth: a linear ramp that resets reads as a fault.
      const arc = smoothstep(0, 0.55, f.phrasePhase) * (1 - smoothstep(0.75, 1, f.phrasePhase));
      const heard = level.update(f.energy, f.beat, f.dt, f.beatPeriod);
      const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
      const gain = (0.5 + p.intensity * 0.85) * clamp(0.45 + heard * 0.55);
      // The whole field slides around the room across the phrase, so a long passage is never
      // twice in the same place even though nothing in it is fast.
      const travel = f.phrasePhase * Math.round(p.sweep * 4 * motion) * 0.5;
      // A spectral term may only walk the slot inside base..glow. Slot space is a ring whose
      // positions differ in VALUE - white is several times glow's luminance - so a walk that
      // crosses it is the spectrum driving brightness, which is what makes a room blink.
      const top = lerp(SLOT.base, SLOT.glow, clamp(tilt));
      for (let i = 0; i < g.count; i++) {
        const u = ringU(g, i) + travel;
        // Two shallow lobes, so the room has a near side and a far side rather than being one
        // slab changing level. Deep lobes light two walls and leave two.
        const lobe = 0.79 + 0.21 * Math.cos((u * 2 - tilt) * Math.PI * 2);
        const v = clamp(clamp(0.45 + arc * 0.5) * lobe);
        // Stateless, so every pixel is written every frame. Nothing clears the buffer for you.
        setSample(out, i, palette, lerp(SLOT.base, top, v * 0.9) + hueShift, (0.38 + v * 0.62) * gain);
      }
    }
  };
}`;

const TRAIL = `function create(g) {
  const rings = ringsFor(g);
  const ring = rings.perimeter;
  // Allocated here, never in render.
  const scratch = new Float32Array(ring.length * 3);
  const env = new PulseEnv();
  let pos = 0;
  return {
    reset() { pos = 0; env.reset(); scratch.fill(0); },
    render(out, ctx) {
      const { f, p, palette, motion } = ctx;
      if (f.kick) env.fire(f.kickEnv);
      const punch = env.decay(f.dt, f.beatPeriod, 0.75);
      // Metres per second rather than pixels, so the speed means the same thing on any strip.
      pos = (pos + pxPerSecond(ring, 2.5 + p.speed * 4) * f.dt * motion) % ring.length;
      // Decay, never clear: keeping a fraction of the last frame is what makes the trail.
      fadeToBlack(scratch, f.dt, 0.14);
      // Colour comes out of the palette by slot, so the show's hues reach this without it
      // knowing any of them. sample() writes into a shared scratch, so use it straight away.
      const rgb = sample(palette, SLOT.accent, p.intensity * (0.35 + punch));
      // Working in the ring's own index space, so a blob near one strip's end cannot bleed onto
      // an unrelated strip; scatter puts it back into the room at the end.
      stampGaussian(scratch, ring.length, pos, 4 + 10 * punch, rgb[0], rgb[1], rgb[2], true);
      out.fill(0);
      scatter(ring, scratch, out);
    }
  };
}`;

export const WORKED_EXAMPLES: readonly WorkedExample[] = [
	{
		id: 'exampleField',
		role: 'bed',
		blurb: 'A field: writes every pixel every frame, reads the grid and the spectrum.',
		source: FIELD
	},
	{
		id: 'exampleTrail',
		role: 'rhythm',
		blurb: 'A trail: its own buffer, decayed rather than cleared, fired by the kick.',
		source: TRAIL
	}
];

export function renderExamples(): string {
	return WORKED_EXAMPLES.map((e) => `${e.blurb}\n\n<example>\n${e.source}\n</example>`).join('\n\n');
}
