// The editor canvas: spectrogram of the mix, one lane per class with its own attack envelope, the
// beat grid, and every mark, proposal and Striker emission on the page.

export const CLASSES = ['kick', 'snare', 'hat', 'cymbal'];
export const NAMES = { kick: 'kick', snare: 'snare, clap', hat: 'hi-hat', cymbal: 'cymbal, ride' };
export const COLOUR = { kick: '#5b9dff', snare: '#ff6f8b', hat: '#4ecf9a', cymbal: '#b389ff' };

export const RULER = 26;
/** Marks on the page boundary would be half a stem wide without it. */
export const PAD = 10;

const HEAD = 20, PROP_TOP = 5;
/** A proposal this strong is real evidence; weaker ones stay a tick and are never bulk accepted. */
export const SUPPORT = 0.12;
/** The editor takes the height the window has to spare; lanes are served before the spectrogram. */
export const metrics = { spec: 152, lane: 88, top: RULER + 152, height: RULER + 152 + 88 * 4 };

export function setMetrics(spec, lane) {
	metrics.spec = spec;
	metrics.lane = lane;
	metrics.top = RULER + spec;
	metrics.height = metrics.top + lane * CLASSES.length;
}

const envBase = () => metrics.lane - 13;
const envMax = () => metrics.lane - HEAD - 21;
const kitY = () => metrics.lane - 8;

export const laneTop = (cls) => metrics.top + CLASSES.indexOf(cls) * metrics.lane;

export function laneAt(y) {
	if (y < metrics.top || y >= metrics.height) return null;
	return CLASSES[Math.floor((y - metrics.top) / metrics.lane)];
}

export function drawEditor(g, m) {
	const { w } = m;
	const span = m.view.to - m.view.from;
	const inner = Math.max(1, w - PAD * 2);
	const toX = (t) => PAD + ((t - m.view.from) / span) * inner;
	g.clearRect(0, 0, w, metrics.height);

	if (m.spectrogram) {
		const scale = m.spectrogram.canvas.width / m.spectrogram.seconds;
		g.imageSmoothingEnabled = false;
		g.drawImage(m.spectrogram.canvas, m.view.from * scale, 0, span * scale,
			m.spectrogram.canvas.height, PAD, RULER, inner, metrics.spec);
		g.imageSmoothingEnabled = true;
	}

	for (const cls of CLASSES) {
		const top = laneTop(cls);
		g.fillStyle = cls === m.active ? '#131317' : '#0c0c0f';
		g.fillRect(0, top, w, metrics.lane);
		g.fillStyle = '#1b1b20';
		g.fillRect(0, top, w, 1);
	}

	drawGrid(g, m, toX);
	for (const cls of CLASSES) drawEnvelope(g, m, toX, cls);
	for (const cls of CLASSES) if (cls !== m.active) drawClass(g, m, toX, cls);
	drawClass(g, m, toX, m.active);
	drawRuler(g, m, toX);
	drawPointer(g, m, toX);
}

function drawGrid(g, m, toX) {
	const bottom = metrics.height;
	g.lineWidth = 1;
	if (m.division > 1) {
		const top = laneTop(m.active);
		g.strokeStyle = '#1f1f26';
		g.beginPath();
		for (const t of subdivisions(m)) {
			const x = Math.round(toX(t)) + 0.5;
			g.moveTo(x, top + 4);
			g.lineTo(x, top + metrics.lane - 4);
		}
		g.stroke();
	}
	for (const down of [false, true]) {
		g.strokeStyle = down ? '#3a3a44' : '#1d1d23';
		g.beginPath();
		for (const t of m.clip.beats) {
			if (t < m.view.from - 0.01 || t > m.view.to + 0.01) continue;
			if (m.clip.downbeats.some((d) => Math.abs(d - t) < 0.01) !== down) continue;
			const x = Math.round(toX(t)) + 0.5;
			g.moveTo(x, RULER);
			g.lineTo(x, bottom);
		}
		g.stroke();
	}
}

/** Every step of the current grid across the page, which is what a fill would place. */
export function subdivisions(m) {
	const beats = m.clip.beats.filter((t) => t >= m.view.from - 1e-6 && t < m.view.to - 1e-6);
	const after = m.clip.beats.find((t) => t >= m.view.to - 1e-6)
		?? (beats.length > 1 ? 2 * beats[beats.length - 1] - beats[beats.length - 2] : m.view.to);
	const out = [];
	beats.forEach((beat, i) => {
		const next = beats[i + 1] ?? after;
		for (let k = 0; k < m.division; k++) {
			const t = beat + ((next - beat) * k) / m.division;
			if (t < m.view.to) out.push(t);
		}
	});
	return out;
}

function drawEnvelope(g, m, toX, cls) {
	const attack = m.attacks[cls];
	if (!attack) return;
	const { env, fps } = attack;
	const base = laneTop(cls) + envBase();
	let peak = 1e-4;
	for (let i = Math.floor(m.view.from * fps); i < Math.min(env.length, m.view.to * fps); i++) {
		peak = Math.max(peak, env[i]);
	}
	const from = Math.round(toX(m.view.from)), to = Math.round(toX(m.view.to));
	g.beginPath();
	g.moveTo(from, base);
	for (let x = from; x <= to; x++) {
		let loudest = 0;
		const a = Math.floor(timeAt(m, x) * fps), b = Math.ceil(timeAt(m, x + 1) * fps);
		for (let i = Math.max(0, a); i <= Math.min(env.length - 1, b); i++) {
			loudest = Math.max(loudest, env[i]);
		}
		g.lineTo(x + 0.5, base - Math.min(1, Math.sqrt(loudest / peak)) * envMax());
	}
	g.lineTo(to, base);
	g.closePath();
	g.fillStyle = cls === m.active ? '#23232b' : '#191920';
	g.fill();
	g.strokeStyle = cls === m.active ? '#3a3a46' : '#26262e';
	g.lineWidth = 1;
	g.stroke();
}

function timeAt(m, x) {
	const inner = Math.max(1, m.w - PAD * 2);
	return m.view.from + ((x - PAD) / inner) * (m.view.to - m.view.from);
}

function drawClass(g, m, toX, cls) {
	const top = laneTop(cls);
	const on = cls === m.active;
	const hits = m.hits[cls] ?? [];
	const near = (t, list, window) => list.some((x) => Math.abs(x - t) < window);

	if (m.showProposals) {
		for (const p of m.clip.proposals[cls] ?? []) {
			if (p.t < m.view.from || p.t > m.view.to) continue;
			const answered = near(p.t, hits, 0.04);
			const x = Math.round(toX(p.t)) + 0.5;
			g.lineWidth = 1;
			if (answered) {
				if (!on) continue;
				g.strokeStyle = '#2a2a32';
				g.beginPath();
				g.moveTo(x, top + PROP_TOP);
				g.lineTo(x, top + PROP_TOP + 5);
				g.stroke();
			} else if (p.score >= SUPPORT) {
				// An unanswered proposal with real support: a hit the marks do not yet account for.
				g.globalAlpha = on ? 0.8 : 0.45;
				g.strokeStyle = COLOUR[cls];
				g.beginPath();
				g.arc(x, top + HEAD, 3.5, 0, Math.PI * 2);
				g.stroke();
				g.globalAlpha = on ? 0.3 : 0.16;
				g.beginPath();
				g.moveTo(x, top + HEAD + 6);
				g.lineTo(x, top + envBase());
				g.stroke();
				g.globalAlpha = 1;
			} else {
				g.globalAlpha = on ? 0.45 : 0.25;
				g.strokeStyle = COLOUR[cls];
				g.beginPath();
				g.moveTo(x, top + PROP_TOP);
				g.lineTo(x, top + PROP_TOP + 3 + Math.min(7, p.score * 40));
				g.stroke();
				g.globalAlpha = 1;
			}
		}
	}

	if (m.showStriker) {
		g.strokeStyle = '#55555f';
		g.lineWidth = 2;
		g.beginPath();
		for (const t of m.clip.striker?.[cls] ?? []) {
			if (t < m.view.from || t > m.view.to) continue;
			const x = Math.round(toX(t)) + 0.5;
			g.moveTo(x, top + kitY());
			g.lineTo(x, top + kitY() + 5);
		}
		g.stroke();
	}

	g.strokeStyle = COLOUR[cls];
	g.fillStyle = COLOUR[cls];
	g.lineWidth = on ? 2 : 1.5;
	g.globalAlpha = on ? 1 : 0.5;
	for (const t of hits) {
		if (t < m.view.from || t > m.view.to) continue;
		const x = Math.round(toX(t)) + 0.5;
		const held = m.drag?.cls === cls && Math.abs(m.drag.t - t) < 1e-9;
		g.beginPath();
		g.moveTo(x, top + HEAD);
		g.lineTo(x, top + envBase());
		g.stroke();
		g.beginPath();
		g.arc(x, top + HEAD, held ? 5 : 3.5, 0, Math.PI * 2);
		g.fill();
		if (held) {
			g.strokeStyle = '#fafafa';
			g.lineWidth = 1;
			g.beginPath();
			g.arc(x, top + HEAD, 7.5, 0, Math.PI * 2);
			g.stroke();
			g.strokeStyle = COLOUR[cls];
			g.lineWidth = on ? 2 : 1.5;
		}
	}
	g.globalAlpha = 1;
}

/** The hover ghost and the fading trace both say where a mark landed and how far it moved. */
function drawPointer(g, m, toX) {
	if (m.hover && !m.drag) {
		const top = laneTop(m.hover.cls);
		g.strokeStyle = '#4a4a55';
		g.lineWidth = 1;
		g.setLineDash([2, 3]);
		g.beginPath();
		const raw = Math.round(toX(m.hover.t)) + 0.5;
		g.moveTo(raw, RULER);
		g.lineTo(raw, metrics.height);
		g.stroke();
		g.setLineDash([]);
		const x = Math.round(toX(m.hover.at)) + 0.5;
		g.globalAlpha = 0.5;
		g.strokeStyle = COLOUR[m.hover.cls];
		g.fillStyle = COLOUR[m.hover.cls];
		g.lineWidth = 2;
		g.beginPath();
		g.moveTo(x, top + HEAD);
		g.lineTo(x, top + envBase());
		g.stroke();
		g.beginPath();
		g.arc(x, top + HEAD, 3.5, 0, Math.PI * 2);
		g.fill();
		g.globalAlpha = 1;
		if (Math.abs(m.hover.at - m.hover.t) > 0.002) arrow(g, raw, x, top + HEAD, '#71717a', 0.9);
	}
	if (m.trace) {
		const top = laneTop(m.trace.cls);
		arrow(g, toX(m.trace.from), toX(m.trace.to), top + HEAD, COLOUR[m.trace.cls], m.trace.alpha);
	}
	if (m.playhead !== null && m.playhead >= m.view.from && m.playhead <= m.view.to) {
		const x = toX(m.playhead);
		g.fillStyle = '#fafafa';
		g.fillRect(x - 0.75, RULER, 1.5, metrics.height - RULER);
		g.beginPath();
		g.moveTo(x - 4, RULER);
		g.lineTo(x + 4, RULER);
		g.lineTo(x, RULER + 5);
		g.fill();
	}
}

function arrow(g, from, to, y, colour, alpha) {
	g.globalAlpha = alpha;
	g.strokeStyle = colour;
	g.lineWidth = 1;
	g.beginPath();
	g.moveTo(from, y - 11);
	g.lineTo(to, y - 11);
	g.stroke();
	const way = Math.sign(to - from) || 1;
	g.beginPath();
	g.moveTo(to, y - 11);
	g.lineTo(to - way * 4, y - 13.5);
	g.lineTo(to - way * 4, y - 8.5);
	g.fillStyle = colour;
	g.fill();
	g.globalAlpha = 1;
}

function drawRuler(g, m, toX) {
	g.fillStyle = '#09090b';
	g.fillRect(0, 0, m.w, RULER);
	g.fillStyle = '#1b1b20';
	g.fillRect(0, RULER - 1, m.w, 1);
	g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
	g.textBaseline = 'alphabetic';
	for (const t of m.clip.beats) {
		if (t < m.view.from - 0.01 || t > m.view.to + 0.01) continue;
		const x = Math.round(toX(t)) + 0.5;
		const down = m.clip.downbeats.some((d) => Math.abs(d - t) < 0.01);
		g.fillStyle = down ? '#52525b' : '#2e2e36';
		g.fillRect(x, down ? RULER - 9 : RULER - 5, 1, down ? 8 : 4);
		if (down) {
			g.fillStyle = '#71717a';
			g.fillText(t.toFixed(2), x + 4, 12);
		}
	}
	const at = m.drag ? m.drag.t : m.hover?.at;
	if (at !== undefined) {
		const x = toX(at);
		const label = at.toFixed(3);
		const width = g.measureText(label).width + 10;
		g.fillStyle = '#16161a';
		g.fillRect(Math.min(m.w - width, Math.max(0, x - width / 2)), 3, width, 15);
		g.fillStyle = '#fafafa';
		g.textAlign = 'center';
		g.fillText(label, Math.min(m.w - width / 2, Math.max(width / 2, x)), 14);
		g.textAlign = 'left';
	}
}
