import { describe, expect, it } from 'vitest';
import type { Show, TrackAnalysis } from '@mv/core';
import { DEFAULT_ROOM, SECTION_KINDS, decodeBase64, roomModel } from '@mv/core';
import { fixtureSong } from './fixture.ts';
import { compareJourney } from './journey.ts';
import { PACK_VERSION, decodePack, encodePack, type PackInput } from './pack.ts';
import { compressPack, decompressPack, packFromWire, packToWire } from './wire.ts';

/**
 * Every number above 15 significant digits in the 27 cached shows: 65 values, 279 occurrences,
 * in palettes, opacities and intensities. JSON decoders that are not correctly rounded miss some.
 */
const LONG_FLOATS = [
	0.08399999999999999, 0.08800000000000001, 0.10400000000000001, 0.11200000000000002,
	0.11900000000000001, 0.14450000000000002, 0.21000000000000002, 0.22499999999999998,
	0.36000000000000004, 0.36432000000000003, 0.44592000000000004, 0.44639999999999996,
	0.44736000000000004, 0.46559999999999996, 0.46895999999999993, 0.5136000000000001,
	0.5336000000000001, 0.5367999999999999, 0.5448000000000001, 0.5496000000000001,
	0.5640000000000001, 0.5720000000000001, 0.5760000000000001, 0.5880000000000001,
	0.5920000000000001, 0.6000000000000001, 0.6072000000000001, 0.6648000000000001,
	0.7392000000000001, 0.7424000000000001, 0.7432000000000001, 0.7472000000000001,
	0.7504000000000001, 0.7575999999999999, 0.8644999999999999, 0.8954880000000001,
	0.9011699999999999, 0.9035452800000001, 0.9128592000000001, 0.9177000000000001,
	0.9206207999999999, 0.9241689599999999, 0.9272736000000001, 0.9306000000000001,
	0.9424800000000001, 0.9449327359999999, 0.9702000000000001, 0.9765000000000001,
	0.9814031999999999, 0.9878669999999999, 0.9906132599999999, 0.9926400000000001,
	0.9938519999999998, 0.9955278000000001, 0.9960300000000002, 0.9966647599999998,
	0.9974429999999999, 13.899999999999977, 90.05000000000001, 102.80000000000001,
	153.64999999999998, 228.64999999999998, 259.04999999999995, 259.54999999999995,
	278.29999999999995
];

/** A JSON block as the Luau decoder reads it: "#" text through exact parsing, "##" unescaped. */
function restore(value: unknown): unknown {
	if (typeof value === 'number') throw new Error('a raw JSON number');
	if (typeof value === 'string') {
		if (value.startsWith('##')) return value.slice(1);
		return value.startsWith('#') ? (value === '#-0' ? -0 : Number(value.slice(1))) : value;
	}
	if (Array.isArray(value)) return value.map(restore);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v)]));
	}
	return value;
}

const room = roomModel(DEFAULT_ROOM);
const one = fixtureSong(1);
const two = fixtureSong(2);
const roundTrip = (song: PackInput) => decodePack(encodePack(song));
const edited = (edit: (song: PackInput) => void): PackInput => {
	const song = structuredClone(one);
	edit(song);
	return song;
};

describe('a Track Pack', () => {
	it('renders byte for byte like the analysis and show it was packed from', () => {
		const packed = [roundTrip(one), roundTrip(two)] as const;
		const forward = compareJourney([one, two], packed, room.geometry, room.lamps.length);
		expect(forward.difference).toBeNull();
		expect(forward.frames).toBeGreaterThan(2000);
		const back = compareJourney([two, one], [packed[1], packed[0]], room.geometry, room.lamps.length);
		expect(back.difference).toBeNull();
	});

	it('keeps every value the renderer reads, exactly', () => {
		const { analysis, show, meta } = roundTrip(one);
		const a = one.analysis;
		expect(analysis.tempo).toMatchObject({
			bpm: a.tempo.bpm,
			firstBeat: a.tempo.firstBeat,
			beatPeriod: a.tempo.beatPeriod,
			beatsPerBar: a.tempo.beatsPerBar,
			downbeatPhase: a.tempo.downbeatPhase,
			phraseAnchorBar: a.tempo.phraseAnchorBar,
			barsPerPhrase: a.tempo.barsPerPhrase,
			barTimes: a.tempo.barTimes
		});
		expect(analysis.duration).toBe(a.duration);
		const rows = (x: TrackAnalysis) => x.bars.map((b) => [b.section, b.energy, b.sub, b.low, b.mid, b.air]);
		expect(rows(analysis)).toEqual(rows(a));
		const spans = (x: TrackAnalysis) =>
			x.sections.map((s) => [s.index, s.kind, s.startBar, s.endBar, s.startTime, s.endTime]);
		expect(spans(analysis)).toEqual(spans(a));
		expect(analysis.envelopes).toEqual(a.envelopes);
		expect(decodeBase64(analysis.spectrum.data)).toEqual(decodeBase64(a.spectrum.data));
		expect([analysis.spectrum.fps, analysis.spectrum.bands]).toEqual([a.spectrum.fps, a.spectrum.bands]);
		expect(decodeBase64(analysis.level!.data)).toEqual(decodeBase64(a.level!.data));
		expect(analysis.level!.fps).toBe(a.level!.fps);
		expect(analysis.stereo).toEqual(a.stereo);
		expect(analysis.onsets).toEqual(a.onsets);
		expect(show).toMatchObject({
			palette: withoutName(one.show.palette),
			defaults: one.show.defaults,
			hits: one.show.hits.map(withoutNote)
		});
		expect(show.cues.map(withoutNote)).toEqual(one.show.cues.map(withoutNote));
		expect(meta).toMatchObject({ ...one.meta, packVersion: PACK_VERSION, analysisHash: a.hash, duration: a.duration });
		expect(roundTrip(two).show).toMatchObject({ exposure: 'fixed', ending: 'hold' });
		expect(roundTrip(two).meta.gridTrusted).toBe(false);
	});

	it('encodes the same song to the same bytes, decoded or not', () => {
		const bytes = encodePack(one);
		expect(encodePack(one)).toEqual(bytes);
		const { analysis, show, meta } = decodePack(bytes);
		expect(encodePack({ analysis, show, meta })).toEqual(bytes);
	});

	it('lays its bytes out as v1 says', () => {
		const bytes = encodePack(one);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let at = 0;
		const step = (n: number) => (at += n) - n;
		const u8 = () => view.getUint8(step(1));
		const i8 = () => view.getInt8(step(1));
		const u16 = () => view.getUint16(step(2), true);
		const u32 = () => view.getUint32(step(4), true);
		const f64 = () => view.getFloat64(step(8), true);
		const json = () => {
			const n = u32();
			return restore(JSON.parse(String.fromCharCode(...bytes.subarray(step(n), at))));
		};
		const kinds = ['intro', 'groove', 'verse', 'breakdown', 'build', 'void', 'drop', 'chorus', 'outro'];
		const a = one.analysis;

		expect(String.fromCharCode(u8(), u8(), u8(), u8())).toBe('LSPK');
		expect([u16(), u16()]).toEqual([1, 1]);
		expect(json()).toEqual({
			trackId: 'fx1',
			title: 'Fixture 1',
			artist: 'Ensemble Číslo',
			duration: a.duration,
			analysisHash: 'fixture-1',
			analysisVersion: a.version,
			showVersion: one.show.version,
			effects: [
				'ambientDrift', 'anthemWash', 'bandBloom', 'blackout', 'blinderWall', 'blockChase', 'breathe',
				'buildStrobe', 'chorusBloom', 'clapAlong', 'colorBump', 'comet', 'crownSpill', 'harmonicRibbon',
				'kitTicks', 'meterBuild', 'pingPong', 'pitchRibbon', 'pump', 'riser', 'silhouette', 'slam',
				'snapSplit', 'snareBlade', 'spectrumBed', 'strobe', 'twoTone', 'undertow', 'vocalGlow', 'vortex',
				'wash'
			],
			rates: { spectrum: 50, level: 100, stereo: 25 }
		});
		const t = a.tempo;
		expect(Array.from({ length: 7 }, f64)).toEqual([
			t.bpm, t.firstBeat, t.beatPeriod, t.beatsPerBar, t.downbeatPhase, t.phraseAnchorBar, t.barsPerPhrase
		]);
		const bars = u32();
		expect(Array.from({ length: bars + 1 }, f64)).toEqual(t.barTimes);
		expect(Array.from({ length: bars }, () => [kinds[u8()], u8(), u8(), u8(), u8(), u8()])).toEqual(
			a.bars.map((b) => [b.section, b.energy, b.sub, b.low, b.mid, b.air])
		);
		expect(Array.from({ length: u32() }, () => [u16(), kinds[u8()], u16(), u16(), f64(), f64()])).toEqual(
			a.sections.map((s) => [s.index, s.kind, s.startBar, s.endBar, s.startTime, s.endTime])
		);
		const beats = u32();
		expect(Array.from({ length: beats }, u8)).toEqual(a.envelopes.energy);
		expect(Array.from({ length: beats * 4 }, u8)).toEqual(a.envelopes.bands);
		const frames = u32();
		const width = u8();
		const spectrum = Array.from({ length: frames * width }, u8);
		for (let i = width; i < spectrum.length; i++) spectrum[i] = (spectrum[i] + spectrum[i - width]) % 256;
		expect(spectrum).toEqual(Array.from(decodeBase64(a.spectrum.data)));
		expect(Array.from({ length: u32() }, u8)).toEqual(Array.from(decodeBase64(a.level!.data)));
		const stereo = u32();
		expect(Array.from({ length: stereo }, () => i8() / 100)).toEqual(a.stereo.pan);
		expect(Array.from({ length: stereo }, () => u8() / 100)).toEqual(a.stereo.width);
		for (const drum of ['kick', 'snare', 'hat'] as const) {
			const n = u32();
			expect(Array.from({ length: n }, f64)).toEqual(a.onsets[drum].times);
			expect(Array.from({ length: n }, () => u8() / 100)).toEqual(a.onsets[drum].levels);
		}
		const body: Show = one.show;
		expect(json()).toEqual({
			palette: withoutName(body.palette),
			defaults: body.defaults,
			cues: body.cues.map(withoutNote),
			hits: body.hits.map(withoutNote)
		});
		expect(at).toBe(bytes.length);
	});

	it('writes every JSON number as exact text and keeps strings that start with "#"', () => {
		const song = edited((s) => {
			const params = Object.fromEntries(LONG_FLOATS.map((v, i) => [`p${i}`, v]));
			s.show.cues[0].layers.bed = { effect: 'wash', params };
			s.show.cues[1].intensity = -0;
			s.meta.title = '#1 Crush';
			s.meta.artist = '##';
		});
		const bytes = encodePack(song);
		const text = Buffer.from(bytes).toString('latin1');
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const block = (at: number) => JSON.parse(text.slice(at + 4, at + 4 + view.getUint32(at, true)));
		const raw = (v: unknown): boolean =>
			typeof v === 'number' || (typeof v === 'object' && v !== null && Object.values(v).some(raw));
		const showAt = text.lastIndexOf('{"palette"') - 4;
		expect(raw(block(8))).toBe(false);
		expect(raw(block(showAt))).toBe(false);
		for (const v of LONG_FLOATS) expect(text).toContain(`"#${v}"`);
		expect(text).toContain('"intensity":"#-0"');
		expect(text).toContain('"title":"##1 Crush","artist":"###"');

		const { show, meta } = decodePack(bytes);
		const params = show.cues[0].layers.bed!.params!;
		expect(LONG_FLOATS.filter((v, i) => !Object.is(params[`p${i}`], v))).toEqual([]);
		expect(Object.is(show.cues[1].intensity, -0)).toBe(true);
		expect([meta.title, meta.artist]).toEqual(['#1 Crush', '##']);
	});

	it('has a code for every section kind', () => {
		const song = edited((s) => {
			s.analysis.bars.forEach((b, i) => (b.section = SECTION_KINDS[i % SECTION_KINDS.length]));
		});
		expect(roundTrip(song).analysis.bars.map((b) => b.section)).toEqual(song.analysis.bars.map((b) => b.section));
	});

	it('plays an analysis without beat envelopes, onset levels or a level curve as the player would', () => {
		const legacy = edited((s) => {
			s.analysis.envelopes = { energy: [], bands: [] };
			s.analysis.onsets.hat.levels = [];
			delete s.analysis.level;
		});
		const packed = roundTrip(legacy);
		expect(packed.analysis.envelopes).toEqual({ energy: [], bands: [] });
		expect(packed.analysis.onsets.hat.levels.every((v) => v === 1)).toBe(true);
		expect(packed.analysis.level).toBeUndefined();
		expect(compareJourney([legacy, two], [packed, roundTrip(two)], room.geometry, room.lamps.length).difference).toBeNull();
	});

	it('refuses what it could not store exactly', () => {
		const refusals: [string, (s: PackInput) => void][] = [
			['a stale show', (s) => (s.show.analysisHash = 'other')],
			[
				'generated effects',
				(s) => s.show.generatedEffects.push({ id: 'x', name: 'x', role: 'bed', blurb: '', params: [], source: '' })
			],
			['an effect that is not built in', (s) => (s.show.cues[0].layers.bed = { effect: 'noSuchEffect' })],
			['a fractional envelope', (s) => (s.analysis.envelopes.energy[3] = 41.5)],
			['an envelope over 100', (s) => (s.analysis.envelopes.bands[2] = 101)],
			['bands without beats', (s) => (s.analysis.envelopes = { energy: [], bands: [10, 20, 30, 40] })],
			['a fractional bar level', (s) => (s.analysis.bars[3].sub = 12.5)],
			['a bar level over 100', (s) => (s.analysis.bars[0].air = 101)],
			['a pan between hundredths', (s) => (s.analysis.stereo.pan[5] = 0.123)],
			['a width over 1', (s) => (s.analysis.stereo.width[5] = 1.01)],
			['an onset level between hundredths', (s) => (s.analysis.onsets.kick.levels[2] = 0.555)],
			['bar times that do not match the bars', (s) => s.analysis.tempo.barTimes.pop()],
			['an unknown section kind', (s) => (s.analysis.sections[1].kind = 'bridge' as never)],
			['a non-finite cue level', (s) => (s.show.cues[1].intensity = Number.NaN)],
			['an unknown hit kind', (s) => (s.show.hits[0].kind = 'flash' as never)],
			['a ragged spectrum', (s) => (s.analysis.spectrum.bands = 19)]
		];
		for (const [what, edit] of refusals) expect(() => encodePack(edited(edit)), what).toThrow();
	});

	it('refuses packs it cannot read', () => {
		const bytes = encodePack(one);
		const patched = (at: number, value: number) => {
			const copy = bytes.slice();
			copy[at] = value;
			return copy;
		};
		expect(() => decodePack(patched(0, 0x4d))).toThrow('not a Track Pack');
		expect(() => decodePack(patched(4, PACK_VERSION + 1))).toThrow('pack version 2');
		expect(() => decodePack(patched(6, 3))).toThrow('unknown pack flags');
		expect(() => decodePack(patched(14, 0xc3))).toThrow('not ASCII');
		expect(() => decodePack(Uint8Array.from([...bytes, 0]))).toThrow('after the show');
		for (const cut of [0, 3, 7, 11, 12, 200, 1000, 5000, 50000, bytes.length - 1]) {
			expect(() => decodePack(bytes.subarray(0, cut)), `cut at ${cut}`).toThrow();
		}
		const text = String.fromCharCode(...bytes.subarray(0, 600));
		const wash = text.indexOf('"wash"');
		expect(() => decodePack(patched(wash + 2, 'e'.charCodeAt(0)))).toThrow('other effects');
		const version = text.indexOf('"#37"');
		const rewritten = (replacement: string) => {
			const copy = bytes.slice();
			for (let i = 0; i < replacement.length; i++) copy[version + i] = replacement.charCodeAt(i);
			return copy;
		};
		expect(() => decodePack(rewritten('  37 '))).toThrow('raw JSON number');
		expect(() => decodePack(rewritten('"#3x"'))).toThrow('bad number');
	});
});

describe('on the wire', () => {
	const pack = encodePack(one);

	it('is one standard zstd frame that states its size and carries a checksum', () => {
		const frame = compressPack(pack);
		const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
		expect(view.getUint32(0, true)).toBe(0xfd2fb528);
		const descriptor = frame[4];
		expect(descriptor >> 6 !== 0 || (descriptor & 0x20) !== 0).toBe(true);
		expect(descriptor & 0x04).toBe(0x04);
		expect(descriptor & 0x03).toBe(0);
		expect(decompressPack(frame)).toEqual(pack);
		const corrupt = frame.slice();
		corrupt[frame.length >> 1] ^= 0xff;
		expect(() => decompressPack(corrupt)).toThrow();
	});

	it('travels as padded base64 of the frame', () => {
		const text = packToWire(pack);
		expect(text).toBe(Buffer.from(compressPack(pack)).toString('base64'));
		expect(packFromWire(text)).toEqual(pack);
		expect(() => packFromWire(`-${text.slice(1)}`)).toThrow('base64');
		expect(() => packFromWire(`${text}\n`)).toThrow('base64');
	});
});

function withoutNote<T extends { note?: string }>({ note: _, ...rest }: T): Omit<T, 'note'> {
	return rest;
}

function withoutName({ name: _, ...rest }: Show['palette']): Show['palette'] {
	return rest;
}
