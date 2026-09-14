// Minimal Standard MIDI File reader: note-on events with absolute times from the tempo map.
import type { DrumClass } from './corpus.ts';

export interface MidiNote {
	time: number;
	channel: number;
	note: number;
	velocity: number;
	track: number;
}

export function readMidi(bytes: Uint8Array): MidiNote[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
	if (text(0) !== 'MThd') throw new Error('Not a MIDI file.');
	const tracks = view.getUint16(10);
	const division = view.getUint16(12);
	if (division & 0x8000) throw new Error('SMPTE time division is not supported.');
	let at = 8 + view.getUint32(4);
	const tempo: { tick: number; usPerQuarter: number }[] = [];
	const raw: { tick: number; channel: number; note: number; velocity: number; track: number }[] = [];
	for (let t = 0; t < tracks; t++) {
		if (text(at) !== 'MTrk') throw new Error('Missing track chunk.');
		const end = at + 8 + view.getUint32(at + 4);
		let p = at + 8;
		let tick = 0;
		let status = 0;
		const vlq = () => {
			let value = 0;
			for (;;) {
				const b = bytes[p++];
				value = (value << 7) | (b & 0x7f);
				if (!(b & 0x80)) return value;
			}
		};
		while (p < end) {
			tick += vlq();
			let b = bytes[p];
			if (b & 0x80) p++;
			else b = status;
			if (b === 0xff) {
				const type = bytes[p++];
				const length = vlq();
				if (type === 0x51) tempo.push({ tick, usPerQuarter: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2] });
				p += length;
				continue;
			}
			if (b === 0xf0 || b === 0xf7) {
				p += vlq();
				continue;
			}
			status = b;
			const kind = b & 0xf0;
			const channel = b & 0x0f;
			if (kind === 0xc0 || kind === 0xd0) {
				p += 1;
				continue;
			}
			const d1 = bytes[p++];
			const d2 = bytes[p++];
			if (kind === 0x90 && d2 > 0) raw.push({ tick, channel, note: d1, velocity: d2, track: t });
		}
		at = end;
	}
	tempo.sort((a, b) => a.tick - b.tick);
	if (!tempo.length || tempo[0].tick > 0) tempo.unshift({ tick: 0, usPerQuarter: 500000 });
	const seconds = (tick: number) => {
		let time = 0;
		for (let i = 0; i < tempo.length; i++) {
			const next = tempo[i + 1]?.tick ?? Infinity;
			if (tick <= tempo[i].tick) break;
			const span = Math.min(tick, next) - tempo[i].tick;
			time += (span * tempo[i].usPerQuarter) / 1e6 / division;
		}
		return time;
	};
	return raw.map((n) => ({ time: seconds(n.tick), channel: n.channel, note: n.note, velocity: n.velocity, track: n.track }))
		.sort((a, b) => a.time - b.time);
}

/** Tambourine, cabasa, maracas and shaker keep time like hats: optional hat references. */
export const SHAKERS = [54, 69, 70, 82];

/** General MIDI percussion keys, as ADTOF's MIDI_REDUCED_5 groups them. */
export function gmClass(note: number): DrumClass {
	if (note === 35 || note === 36) return 'kick';
	if (note === 37 || note === 38 || note === 39 || note === 40) return 'snare';
	if (note === 42 || note === 44 || note === 46) return 'hat';
	if ([41, 43, 45, 47, 48, 50].includes(note)) return 'tom';
	if ([49, 51, 52, 53, 55, 57, 59].includes(note)) return 'cymbal';
	if (SHAKERS.includes(note)) return 'hat';
	return 'other';
}
