// Confirm every kick, snare, hi-hat and cymbal in a clip, one page of two bars at a time. Only
// pages the owner confirms become ground truth; the rest stay unjudged.
import { buildSpectrogram, envelope, snapTime } from './dsp.js';
import { buildPages } from './pages.js';
import { Transport } from './transport.js';
import {
	CLASSES, COLOUR, NAMES, PAD, RULER, SUPPORT, drawEditor, laneAt, metrics, setMetrics,
	subdivisions
} from './view.js';

/** Steps per beat: a quarter down to a 32nd, then eighth and sixteenth triplets. */
const DIVISIONS = [
	{ steps: 1, label: '1/4' }, { steps: 2, label: '1/8' }, { steps: 4, label: '1/16' },
	{ steps: 8, label: '1/32' }, { steps: 3, label: '1/8T' }, { steps: 6, label: '1/16T' }
];
const SPEEDS = [1, 0.5, 0.25];
const SAME_S = 0.008;

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const g = canvas.getContext('2d');
const audio = new AudioContext({ sampleRate: 44100 });
const transport = new Transport(audio);

let index = [];
let saved = {};
const pageCounts = {};
let clip = null;
let annotation = null;
let buffers = {};
let spectrogram = null;
let attacks = {};
let pages = [];
let dispute = [];
let page = 0;
let active = 'kick';
let division = 0;
let speed = 1;
let solo = false;
let history = [];
let hover = null;
let drag = null;
let trace = null;
let note = '';
let saveTimer = 0;
let pending = null;
let animating = false;

const view = () => pages[page] ?? { from: 0, to: clip?.seconds ?? 1 };
const hits = (cls = active) => annotation.hits[cls];
const inPage = (t, v = view()) => t >= v.from && t < v.to;
const width = () => canvas.clientWidth;
const timeAt = (x) => {
	const v = view();
	return v.from + ((x - PAD) / Math.max(1, width() - PAD * 2)) * (v.to - v.from);
};
const round = (t) => +t.toFixed(4);

/* ---------- clip ---------- */

/** Identical to the paging export.ts rebuilds; a confirmed index must mean the same stretch. */
/** Where Striker and the proposals disagree: an unanswered proposal, or a hit nothing backs. */
function buildDispute(source, list) {
	return list.map((v) => {
		let score = 0;
		for (const cls of CLASSES) {
			const emitted = (source.striker?.[cls] ?? []).filter((t) => inPage(t, v));
			for (const p of source.proposals[cls] ?? []) {
				if (!inPage(p.t, v) || p.score < SUPPORT) continue;
				if (!emitted.some((t) => Math.abs(t - p.t) < 0.04)) score++;
			}
			for (const t of emitted) {
				if (!(source.proposals[cls] ?? []).some((p) => Math.abs(p.t - t) < 0.04)) score++;
			}
		}
		return score;
	});
}

async function loadClip(id) {
	transport.stop();
	$('clipTitle').textContent = 'Loading';
	$('clipArtist').textContent = '';
	clip = null;
	renderRail();
	const loaded = await (await fetch(`/clips/${id}/clip.json`)).json();
	buffers = {};
	await Promise.all(['mix', ...CLASSES].map(async (name) => {
		const raw = await (await fetch(`/clips/${id}/${name}.wav`)).arrayBuffer();
		buffers[name] = await audio.decodeAudioData(raw);
	}));
	clip = loaded;
	spectrogram = buildSpectrogram(buffers.mix);
	attacks = Object.fromEntries(CLASSES.map((cls) => [cls, envelope(buffers[cls])]));
	attacks.mix = envelope(buffers.mix);
	const stored = saved[id];
	annotation = stored ?? {
		id, corpus: clip.corpus, track: clip.track, title: clip.title, genre: clip.genre,
		start: clip.start, seconds: clip.seconds,
		hits: Object.fromEntries(CLASSES.map((cls) => [cls, (clip.striker?.[cls] ?? []).slice()])),
		confirmed: []
	};
	for (const cls of CLASSES) annotation.hits[cls] ??= [];
	annotation.confirmed ??= [];
	saved[id] = annotation;
	pages = buildPages(clip);
	pageCounts[id] = pages.length;
	dispute = buildDispute(clip, pages);
	page = Math.max(0, pages.findIndex((_, i) => !annotation.confirmed.includes(i)));
	history = [];
	hover = null;
	note = '';
	localStorage.setItem('annotate.clip', id);
	render();
	renderRail();
}

/* ---------- rendering ---------- */

function render() {
	if (!clip) return;
	renderHead();
	renderStrip();
	renderChips();
	renderTools();
	renderBar();
	renderReadout();
	fit();
	draw();
}

function renderHead() {
	$('clipTitle').textContent = clip.title;
	$('clipArtist').textContent = clip.artist ?? '';
	$('clipGenre').textContent = clip.genre;
	$('clipGenre').hidden = !clip.genre;
	const done = annotation.confirmed.length;
	const marks = CLASSES.reduce((sum, cls) => sum + hits(cls).length, 0);
	$('clipStat').innerHTML = `<b class="mono">${done}</b> of <b class="mono">${pages.length}`
		+ `</b> pages<span class="sep">·</span><b class="mono">${marks}</b> marks`;
	$('confirmAll').disabled = done === pages.length;
	const set = Object.values(saved).reduce((sum, a) => sum + (a.confirmed?.length ?? 0), 0);
	const started = Object.values(saved).filter((a) => a.confirmed?.length).length;
	$('setStat').innerHTML = `<b class="mono">${set}</b> ${set === 1 ? 'page' : 'pages'} confirmed`
		+ `<span class="sep">·</span><b class="mono">${started}</b> of `
		+ `<b class="mono">${index.length}</b> clips started`;
}

function renderStrip() {
	const worst = Math.max(1, ...dispute);
	$('pageCells').innerHTML = pages.map((p, i) => {
		const on = annotation.confirmed.includes(i);
		const marks = CLASSES.reduce((sum, cls) => sum + hits(cls).filter((t) => inPage(t, p)).length, 0);
		const heat = dispute[i] / worst;
		return `<button class="cell${on ? ' on' : ''}${i === page ? ' here' : ''}"
			data-page="${i}" style="flex-grow:${(p.to - p.from).toFixed(2)}"
			title="Page ${i + 1}, ${(p.to - p.from).toFixed(1)} s, ${marks} marks, `
			+ `${dispute[i]} disputed">${on ? '' : `<i style="opacity:${heat.toFixed(2)}"></i>`}`
			+ `<span class="mono">${i + 1}</span></button>`;
	}).join('');
	for (const cell of $('pageCells').children) {
		cell.addEventListener('click', () => goto(Number(cell.dataset.page)));
	}
}

function renderChips() {
	const v = view();
	$('classChips').innerHTML = CLASSES.map((cls, i) => `<button class="chip${
		cls === active ? ' on' : ''}" data-cls="${cls}" style="--cls:${COLOUR[cls]}">
		<span class="dot"></span><span class="name">${NAMES[cls]}</span><kbd>${i + 1}</kbd>
		<span class="count mono">${hits(cls).filter((t) => inPage(t, v)).length}</span>
		</button>`).join('');
	for (const chip of $('classChips').children) {
		chip.addEventListener('click', () => choose(chip.dataset.cls));
	}
}

function renderTools() {
	$('toolDot').style.background = COLOUR[active];
	$('undo').disabled = !history.length;
	$('copyPage').disabled = page === 0;
	segment('divisions', DIVISIONS.map((d) => ({ id: d.label, label: d.label })),
		DIVISIONS[division].label, (id) => {
			division = DIVISIONS.findIndex((d) => d.label === id);
			say(`The grid is ${id}`);
			render();
		});
}

function renderBar() {
	const v = view();
	$('pageLabel').innerHTML = `<b class="mono">${page + 1}</b>/<b class="mono">${pages.length}`
		+ `</b><span class="sep">·</span><b class="mono">${(v.to - v.from).toFixed(1)}</b> s`;
	$('pageLabel').title = `Page ${page + 1} of ${pages.length}`;
	$('prev').disabled = page === 0;
	$('next').disabled = page >= pages.length - 1;
	const on = annotation.confirmed.includes(page);
	$('unconfirm').hidden = !on;
	$('confirmLabel').textContent = on ? 'Next page' : 'Confirm page';
	const playing = transport.playing;
	$('playGlyph').hidden = playing;
	$('stopGlyph').hidden = !playing;
	$('playLabel').textContent = playing ? 'Stop' : 'Play';
	$('play').classList.toggle('live', playing);
	segment('speeds', SPEEDS.map((s) => ({ id: String(s), label: `${s}x` })), String(speed), (id) => {
		speed = Number(id);
		restart();
		render();
	});
	segment('sources', [{ id: 'mix', label: 'the mix' },
		{ id: 'solo', label: `${active} alone` }], solo ? 'solo' : 'mix', (id) => {
		solo = id === 'solo';
		restart();
		render();
	});
}

function renderReadout() {
	const v = view();
	const marks = CLASSES.reduce((sum, cls) => sum + hits(cls).filter((t) => inPage(t, v)).length, 0);
	$('readout').innerHTML = note || (annotation.confirmed.includes(page)
		? 'This page is ground truth. Move on, or edit it and it stays confirmed.'
		: marks === 0
			? 'Nothing marked here. Fill the grid or accept the proposals, then fix what this bar '
				+ 'does differently.'
			: 'Loop the page: a click with no drum is a wrong mark, a drum with no click is a miss.');
	$('readout').classList.toggle('said', Boolean(note));
}

function renderRail() {
	const query = $('filter').value.trim().toLowerCase();
	const shown = index.filter((c) => !query
		|| `${c.title} ${c.artist} ${c.genre}`.toLowerCase().includes(query));
	$('clipList').innerHTML = shown.map((c) => {
		const total = pageCounts[c.id] ?? 0;
		const done = saved[c.id]?.confirmed?.length ?? 0;
		const state = !done ? '' : total && done >= total ? ' full' : ' part';
		return `<button class="clip${c.id === annotation?.id ? ' on' : ''}${state}" data-id="${c.id}">
			<span class="text"><span class="title truncate">${safe(c.title)}</span>
			<span class="sub truncate">${safe(c.artist ?? '')}</span></span>
			<span class="tail"><span class="genre">${safe(c.genre)}</span>
			${done ? `<span class="mono">${done}${total ? '/' + total : ''}</span>` : ''}</span>
		</button>`;
	}).join('');
	for (const row of $('clipList').children) {
		row.addEventListener('click', () => {
			if (row.dataset.id !== annotation?.id) void loadClip(row.dataset.id);
		});
	}
}

function safe(text) {
	return String(text).replace(/[&<>"]/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function segment(id, options, value, onpick) {
	const host = $(id);
	if (host.children.length !== options.length) {
		host.innerHTML = options.map(() => '<button></button>').join('');
	}
	options.forEach((option, i) => {
		const button = host.children[i];
		button.textContent = option.label;
		button.classList.toggle('on', option.id === value);
		button.onclick = () => onpick(option.id);
	});
}

/** The editor fills the window: lanes take the spare height first, then the spectrogram. */
function fit() {
	const room = document.querySelector('.editor').clientHeight;
	let lane = Math.max(64, Math.min(140, Math.floor((room - RULER - 152) / CLASSES.length)));
	const spec = Math.max(72, Math.min(280, room - RULER - lane * CLASSES.length));
	if (RULER + spec + lane * CLASSES.length > room) {
		lane = Math.max(52, Math.floor((room - RULER - spec) / CLASSES.length));
	}
	if (lane === metrics.lane && spec === metrics.spec) return;
	setMetrics(spec, lane);
	document.documentElement.style.setProperty('--lane', `${lane}px`);
	document.documentElement.style.setProperty('--spec', `${RULER + spec}px`);
}

function draw() {
	if (!clip) return;
	const dpr = devicePixelRatio || 1;
	canvas.style.height = `${metrics.height}px`;
	canvas.width = Math.round(width() * dpr);
	canvas.height = Math.round(metrics.height * dpr);
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	drawEditor(g, {
		w: width(), view: view(), clip, hits: annotation.hits, spectrogram, attacks, active,
		division: DIVISIONS[division].steps, showProposals: $('showProposals').checked,
		showStriker: $('showStriker').checked, hover, drag, trace, playhead: transport.position()
	});
}

/* ---------- editing ---------- */

function remember() {
	history.push(JSON.stringify(annotation.hits));
	if (history.length > 80) history.shift();
	note = '';
}

function say(text) {
	note = text;
}

/**
 * A distorted electronic kick barely reaches its separated source, so that lane has no attack to
 * snap to and a click would land wherever the mouse was. The mixture always has one.
 */
function snapFor(cls, t) {
	const at = snapTime(attacks[cls], t);
	return at === t ? snapTime(attacks.mix, t) : at;
}

function place(cls, t, exact) {
	return round(exact ? t : snapFor(cls, t));
}

function addHit(cls, t, exact) {
	const at = place(cls, t, exact);
	if (hits(cls).some((x) => Math.abs(x - at) < SAME_S)) {
		say(`There is already a ${NAMES[cls]} mark at ${at.toFixed(3)} s`);
		render();
		return;
	}
	remember();
	hits(cls).push(at);
	hits(cls).sort((a, b) => a - b);
	const moved = Math.round((at - t) * 1000);
	trace = { cls, from: t, to: at, born: performance.now(), alpha: 1 };
	say(`${NAMES[cls]} at ${at.toFixed(3)} s`
		+ (moved ? `, pulled ${Math.abs(moved)} ms onto the attack` : ', placed as clicked'));
	save();
}

function nearestHit(cls, t, tolerance) {
	let best = -1, distance = tolerance;
	hits(cls).forEach((x, i) => {
		if (Math.abs(x - t) < distance) {
			distance = Math.abs(x - t);
			best = i;
		}
	});
	return best;
}

function replacePage(added, what) {
	const v = view();
	remember();
	const kept = hits().filter((t) => !inPage(t, v));
	const unique = [];
	for (const t of added.sort((a, b) => a - b)) {
		if (!unique.length || t - unique[unique.length - 1] >= SAME_S) unique.push(round(t));
	}
	annotation.hits[active] = [...kept, ...unique].sort((a, b) => a - b);
	say(`${unique.length} ${NAMES[active]} ${unique.length === 1 ? 'mark' : 'marks'} ${what}`);
	save();
}

function fillGrid() {
	const times = subdivisions({ clip, view: view(), division: DIVISIONS[division].steps });
	if (!times.length) return;
	replacePage(times.map((t) => snapFor(active, t)), `on ${DIVISIONS[division].label}`);
}

function fillBackbeat() {
	const v = view();
	const beats = clip.beats.filter((t) => t >= v.from - 1e-6 && t < v.to - 1e-6);
	const back = beats.filter((beat, i) => (clip.downbeats.length ? beatIndex(beat) : i) % 2 === 1);
	if (!back.length) return;
	replacePage(back.map((t) => snapFor(active, t)), 'on the backbeat');
}

/** How far a beat is from its bar start, in beats, so a backbeat fill lands on 2 and 4. */
function beatIndex(beat) {
	const bar = [...clip.downbeats].reverse().find((d) => d <= beat + 1e-6) ?? clip.beats[0];
	return clip.beats.filter((t) => t >= bar - 1e-6 && t < beat - 1e-6).length;
}

function copyPrevious() {
	if (page === 0) return;
	const v = view();
	const before = pages[page - 1];
	const shift = v.from - before.from;
	const copied = hits().filter((t) => inPage(t, before))
		.map((t) => snapFor(active, t + shift)).filter((t) => t < v.to);
	replacePage(copied, 'copied from the page before');
}

function acceptProposals() {
	const v = view();
	const supported = (clip.proposals[active] ?? [])
		.filter((p) => inPage(p.t, v) && p.score >= SUPPORT);
	const added = hits().filter((t) => inPage(t, v));
	for (const p of supported) {
		if (!added.some((t) => Math.abs(t - p.t) < 0.02)) added.push(p.t);
	}
	replacePage(added, 'after the proposals');
}

function clearPage() {
	replacePage([], 'left on the page');
}

function undo() {
	const previous = history.pop();
	if (!previous) return;
	annotation.hits = JSON.parse(previous);
	say('Undone');
	save();
}

/* ---------- pages ---------- */

function goto(next) {
	page = Math.max(0, Math.min(pages.length - 1, next));
	note = '';
	hover = null;
	if (transport.playing) restart();
	render();
}

function choose(cls) {
	active = cls;
	if (transport.playing && solo) restart();
	render();
}

function confirmPage() {
	if (!annotation.confirmed.includes(page)) {
		annotation.confirmed.push(page);
		annotation.confirmed.sort((a, b) => a - b);
		save();
	}
	const next = pages.findIndex((_, i) => i > page && !annotation.confirmed.includes(i));
	const wrapped = next >= 0 ? next : pages.findIndex((_, i) => !annotation.confirmed.includes(i));
	if (wrapped >= 0) goto(wrapped);
	else {
		say('Every page of this clip is confirmed.');
		render();
	}
}

function unconfirm() {
	annotation.confirmed = annotation.confirmed.filter((i) => i !== page);
	say('This page no longer counts.');
	save();
}

function mostDisputed() {
	let best = -1, score = -1;
	for (let i = 0; i < pages.length; i++) {
		if (annotation.confirmed.includes(i) || dispute[i] <= score) continue;
		score = dispute[i];
		best = i;
	}
	if (best < 0) {
		say('Every page of this clip is confirmed.');
		render();
		return;
	}
	goto(best);
	say(`${score} disagreements between Striker and the proposals here.`);
	render();
}

/* ---------- saving ---------- */

function save() {
	pending = {
		id: annotation.id, corpus: annotation.corpus, track: annotation.track,
		title: annotation.title, genre: annotation.genre, start: annotation.start,
		seconds: annotation.seconds, hits: annotation.hits, confirmed: annotation.confirmed,
		updated: new Date().toISOString()
	};
	if (annotation.reviewed !== undefined) pending.reviewed = annotation.reviewed;
	$('saveState').textContent = 'Saving';
	$('saveState').className = 'savestate busy';
	clearTimeout(saveTimer);
	saveTimer = setTimeout(flush, 350);
	render();
	renderRail();
}

async function flush() {
	if (!pending) return;
	const body = JSON.stringify(pending);
	const id = pending.id;
	pending = null;
	try {
		const response = await fetch(`/save/${id}`, { method: 'POST', body });
		if (!response.ok) throw new Error(await response.text());
		$('saveState').textContent = 'Saved';
		$('saveState').className = 'savestate';
	} catch (error) {
		$('saveState').textContent = `Not saved: ${error.message}`;
		$('saveState').className = 'savestate bad';
	}
}

addEventListener('pagehide', () => {
	if (pending) navigator.sendBeacon(`/save/${pending.id}`, JSON.stringify(pending));
});

/* ---------- playback ---------- */

function marksForClick() {
	if (!$('clicks').checked) return [];
	const v = view();
	return CLASSES.flatMap((cls) => hits(cls).filter((t) => inPage(t, v)).map((t) => ({ t, cls })));
}

function playPage() {
	const v = view();
	const name = solo ? active : 'mix';
	transport.play({
		buffer: buffers[name], from: v.from, to: v.to, rate: speed,
		gain: solo ? 1.6 : 0.9, marks: marksForClick(), active
	});
	render();
	animate();
}

function restart() {
	if (transport.playing) playPage();
}

function toggleTransport() {
	if (transport.playing) {
		transport.stop();
		render();
	} else playPage();
}

/** One loop, whatever asked for it: the playhead and the fading snap trace both need frames. */
function animate() {
	if (animating) return;
	animating = true;
	requestAnimationFrame(function frame() {
		const fading = trace && performance.now() - trace.born < 900;
		if (!transport.playing && !fading) {
			animating = false;
			if (trace) {
				trace = null;
				draw();
			}
			return;
		}
		if (trace) trace.alpha = Math.max(0, 1 - (performance.now() - trace.born) / 900);
		draw();
		requestAnimationFrame(frame);
	});
}

/* ---------- pointer ---------- */

function at(event) {
	const rect = canvas.getBoundingClientRect();
	return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (event) => {
	if (!clip) return;
	const { x, y } = at(event);
	const lane = laneAt(y);
	if (!lane) return;
	if (lane !== active) choose(lane);
	const t = timeAt(x);
	const tolerance = ((view().to - view().from) / Math.max(1, width() - PAD * 2)) * 7;
	const found = nearestHit(lane, t, tolerance);
	if (event.button === 2 || event.altKey) {
		if (found >= 0) {
			remember();
			const [gone] = hits(lane).splice(found, 1);
			say(`${NAMES[lane]} at ${gone.toFixed(3)} s removed`);
			save();
		}
		return;
	}
	if (found >= 0) {
		remember();
		drag = { cls: lane, i: found, t: hits(lane)[found], from: hits(lane)[found] };
		canvas.setPointerCapture(event.pointerId);
		draw();
	} else {
		addHit(lane, t, event.shiftKey);
		animate();
	}
});

canvas.addEventListener('pointermove', (event) => {
	if (!clip) return;
	const { x, y } = at(event);
	if (drag) {
		drag.t = Math.max(0, Math.min(clip.seconds, timeAt(x)));
		hits(drag.cls)[drag.i] = drag.t;
		draw();
		return;
	}
	const lane = laneAt(y);
	const t = lane ? timeAt(x) : 0;
	const over = lane
		&& nearestHit(lane, t, ((view().to - view().from) / Math.max(1, width() - PAD * 2)) * 7) >= 0;
	hover = lane && !over ? { cls: lane, t, at: place(lane, t, event.shiftKey) } : null;
	canvas.style.cursor = !lane ? 'default' : over ? 'grab' : 'crosshair';
	draw();
});

canvas.addEventListener('pointerleave', () => {
	hover = null;
	draw();
});

canvas.addEventListener('pointerup', (event) => {
	if (!drag) return;
	const list = hits(drag.cls);
	const dropped = place(drag.cls, list[drag.i], event.shiftKey);
	list[drag.i] = dropped;
	list.sort((a, b) => a - b);
	const moved = Math.round((dropped - drag.from) * 1000);
	say(`${NAMES[drag.cls]} moved ${moved >= 0 ? '+' : ''}${moved} ms to ${dropped.toFixed(3)} s`);
	drag = null;
	save();
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

/* ---------- keys ---------- */

addEventListener('keydown', (event) => {
	if (event.metaKey || event.ctrlKey) return;
	const tag = event.target.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA') {
		if (event.key === 'Escape' || event.key === 'Enter') event.target.blur();
		return;
	}
	if (!clip) return;
	const key = event.key.toLowerCase();
	if (key === '?') toggleSheet();
	else if (key === 'escape') $('sheet').hidden = true;
	else if (key === ' ') toggleTransport();
	else if (key >= '1' && key <= '4') choose(CLASSES[Number(key) - 1]);
	else if (key === 'arrowright') goto(page + 1);
	else if (key === 'arrowleft') goto(page - 1);
	else if (key === 'f') fillGrid();
	else if (key === 'b') fillBackbeat();
	else if (key === 'c') copyPrevious();
	else if (key === 'a') acceptProposals();
	else if (key === 'x') clearPage();
	else if (key === 'z') undo();
	else if (key === 'n') mostDisputed();
	else if (key === 'q') {
		division = (division + 1) % DIVISIONS.length;
		say(`The grid is ${DIVISIONS[division].label}`);
		render();
	} else if (key === 's') {
		solo = true;
		restart();
		render();
	} else if (key === 'm') {
		solo = false;
		restart();
		render();
	} else if (key === 'enter') confirmPage();
	else return;
	event.preventDefault();
});

/* ---------- controls ---------- */

function toggleSheet() {
	$('sheet').hidden = !$('sheet').hidden;
}

$('keysButton').addEventListener('click', toggleSheet);
$('sheetClose').addEventListener('click', toggleSheet);
$('sheet').addEventListener('click', (event) => {
	if (event.target === $('sheet')) toggleSheet();
});
$('filter').addEventListener('input', renderRail);
$('prev').addEventListener('click', () => goto(page - 1));
$('next').addEventListener('click', () => goto(page + 1));
$('play').addEventListener('click', toggleTransport);
$('confirm').addEventListener('click', confirmPage);
$('unconfirm').addEventListener('click', unconfirm);
$('disputed').addEventListener('click', mostDisputed);
$('fill').addEventListener('click', fillGrid);
$('backbeat').addEventListener('click', fillBackbeat);
$('copyPage').addEventListener('click', copyPrevious);
$('accept').addEventListener('click', acceptProposals);
$('clearPage').addEventListener('click', clearPage);
$('undo').addEventListener('click', undo);
$('confirmAll').addEventListener('click', () => {
	annotation.confirmed = pages.map((_, i) => i);
	say('Every page of this clip counts as ground truth now.');
	save();
});
// A control that keeps focus after a click swallows space and enter, so the page takes focus back.
addEventListener('click', (event) => {
	const focused = document.activeElement;
	if (event.detail > 0 && focused && focused !== $('filter')) focused.blur();
});
$('clicks').addEventListener('change', restart);
for (const id of ['showProposals', 'showStriker']) $(id).addEventListener('change', draw);
addEventListener('resize', () => {
	fit();
	draw();
});

/* ---------- start ---------- */

index = await (await fetch('/clips/index.json')).json();
saved = await (await fetch('/annotations')).json();
renderRail();
await loadClip(localStorage.getItem('annotate.clip') ?? index[0].id);

// The rail shows every clip's progress as a fraction, which needs its page count. The metadata is
// small next to the audio, so it arrives in the background once the first clip is playable.
await Promise.all(index.map(async (entry) => {
	if (pageCounts[entry.id]) return;
	const meta = await (await fetch(`/clips/${entry.id}/clip.json`)).json();
	pageCounts[entry.id] = buildPages(meta).length;
}));
renderRail();
