import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	BUILT_IN_EFFECTS, DEFAULT_ROOM, EffectRegistry, Mixer, ShowPlayer, buildGeometry, makePalette,
	quietFrames, scriptFrames, type ShowFrame, type Show, type TrackAnalysis
} from '@mv/core';
import { createShowFrame } from '../packages/core/src/contracts/frame.ts';
import { benchmarkCache } from './cache.ts';

// node bench/effectpolish.ts --save cache/effect-before.json
// node bench/effectpolish.ts --compare cache/effect-before.json --html cache/effect-polish.html
const args = process.argv.slice(2);
const flag = (name: string) => {
	const at = args.indexOf(`--${name}`);
	return at < 0 ? undefined : args[at + 1];
};
const g = buildGeometry(DEFAULT_ROOM);
const duration = 12;
const fps = 60;
const pixels = Array.from({ length: 144 }, (_, i) => Math.floor(i * g.count / 144));
const geometry = pixels.map((i) => [g.nx[i], g.ny[i]]);
const definitions = ['chorusBloom', 'ambientDrift', 'bandBloom'];

function steady(): ShowFrame[] {
	return Array.from({ length: duration * fps }, (_, i) => {
		const f = createShowFrame();
		f.t = i / fps;
		f.dt = 1 / fps;
		f.beatPeriod = 0.5;
		f.section = 'intro';
		f.energy = 0.2;
		f.spectrum.fill(0.3);
		f.bands.fill(0.2);
		return f;
	});
}

interface Capture {
	effect: string;
	scenario: string;
	mean: number;
	fast: number;
	slow: number;
	frames: number[][];
}
const scenarios = [
	{ name: 'Sparse intro', frames: quietFrames(100, 8).slice(0, duration * fps), motion: 0.45 },
	{ name: 'Sustained intro', frames: steady(), motion: 0.45 },
	{ name: 'Chorus', frames: scriptFrames().filter((f) => f.section === 'drop').slice(0, duration * fps), motion: 1 }
];
for (const [id, title] of [['tWEaUKCQ8Fg', 'Habibi'], ['bEgS_KJCxTU', 'Sunset']]) {
	try {
		const analysis = JSON.parse(readFileSync(resolve(benchmarkCache(), `${id}.analysis.json`), 'utf8')) as TrackAnalysis;
		const show = JSON.parse(readFileSync(resolve(benchmarkCache(), `${id}.show.json`), 'utf8')) as Show;
		for (const kind of ['intro', 'chorus']) {
			const section = analysis.sections.find((s) => kind === 'intro' ? s.kind === 'intro' : s.kind === 'chorus' || s.kind === 'drop');
			if (!section) continue;
			const player = new ShowPlayer(new Mixer(g), new EffectRegistry(BUILT_IN_EFFECTS));
			player.load(analysis, show);
			const frames: ShowFrame[] = [];
			for (let k = 0; k < duration * fps; k++) {
				const f = player.update(section.startTime + k / fps, 1 / fps);
				frames.push({ ...f, bands: Float32Array.from(f.bands), spectrum: Float32Array.from(f.spectrum) });
			}
			scenarios.push({ name: `${title} ${kind} (${section.startTime.toFixed(1)}s)`, frames, motion: kind === 'intro' ? 0.45 : 1 });
		}
	} catch (error) {
		console.error(`${title}: ${(error as Error).message}`);
	}
}
const captures: Capture[] = [];
for (const id of definitions) {
	const def = BUILT_IN_EFFECTS.find((d) => d.id === id)!;
	for (const scenario of scenarios) {
		const mixer = new Mixer(g);
		mixer.layers[def.role].setEffect(def, g);
		mixer.palette = makePalette({ base: 320, accent: 175, third: 260 });
		mixer.intensity = /chorus/i.test(scenario.name) ? 0.9 : 0.65;
		mixer.motion = scenario.motion;
		mixer.floor = 0;
		const fast = new Float32Array(g.count * 3);
		const slow = new Float32Array(g.count * 3);
		const row: Capture = { effect: id, scenario: scenario.name, mean: 0, fast: 0, slow: 0, frames: [] };
		let measured = 0;
		for (let k = 0; k < scenario.frames.length; k++) {
			mixer.render(scenario.frames[k]);
			for (let i = 0; i < fast.length; i++) {
				const v = mixer.bytes[i];
				fast[i] += (v - fast[i]) * (1 - Math.exp(-1 / (fps * 0.08)));
				slow[i] += (v - slow[i]) * (1 - Math.exp(-1 / (fps * 0.8)));
				if (k < fps * 2) continue;
				row.mean += v;
				row.fast += Math.abs(v - fast[i]);
				row.slow += Math.abs(v - slow[i]);
				measured++;
			}
			if (k % 2 === 0) row.frames.push(pixels.flatMap((i) => Array.from(mixer.bytes.slice(i * 3, i * 3 + 3))));
		}
		row.mean /= measured;
		row.fast /= measured;
		row.slow /= measured;
		captures.push(row);
	}
}
console.table(captures.map(({ frames, ...row }) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? Number(v.toFixed(3)) : v]))));
const snapshot = { geometry, fps: fps / 2, captures };
const save = flag('save');
if (save) {
	mkdirSync(dirname(resolve(save)), { recursive: true });
	writeFileSync(save, JSON.stringify(snapshot));
}
const html = flag('html');
if (html) {
	const compare = flag('compare');
	const before = compare ? JSON.parse(readFileSync(compare, 'utf8')) : snapshot;
	const data = JSON.stringify({ before, after: snapshot }).replace(/</g, '\\u003c');
	const page = `<!doctype html><meta charset="utf-8"><title>LightningStrike effect comparison</title>
<style>body{background:#101119;color:#e9e7ee;font:16px system-ui;margin:32px auto;max-width:1200px}h1{font-size:26px;font-weight:550}p{color:#b2b0be}select,button,input{font:inherit;padding:8px;background:#252531;border:1px solid #494656;border-radius:8px;color:inherit}main{display:flex;gap:24px}article{flex:1;min-width:0;background:#151620;border-radius:14px;padding:16px}canvas{width:100%;aspect-ratio:1}nav{display:flex;align-items:center;gap:12px;margin:24px 0}input{flex:1}small{display:block;color:#b2b0be;font-variant-numeric:tabular-nums}strong{font-weight:550}</style>
<h1>LightningStrike · effect comparison</h1><p>Identical audio features and palette, delivered RGB bytes. The ring view shows isolated effects at practical opacity; room reflections and other layers are absent.</p>
<nav><select id="effect"></select><select id="scenario"></select><button id="play">Pause</button><input id="seek" type="range" min="0" max="359" value="0"><span id="time"></span></nav>
<main><article><strong>Before</strong><canvas id="before" width="650" height="600"></canvas><small id="beforeStats"></small></article><article><strong>After</strong><canvas id="after" width="650" height="600"></canvas><small id="afterStats"></small></article></main>
<p>Fast residual: motion over 80 ms, where flicker and transient edges appear. Slow residual: motion over 800 ms. Lower fast movement with clear slow movement is useful for beds; metrics alone do not establish visual quality.</p>
<script>const data=${data};let playing=true,frame=0,last=0;const effect=document.getElementById('effect'),scenario=document.getElementById('scenario'),seek=document.getElementById('seek');for(const [select,values] of [[effect,[...new Set(data.after.captures.map(x=>x.effect))]],[scenario,[...new Set(data.after.captures.map(x=>x.scenario))]]])for(const value of values)select.add(new Option(value,value));
function draw(){for(const side of ['before','after']){const d=data[side],row=d.captures.find(x=>x.effect===effect.value&&x.scenario===scenario.value),a=row.frames[Math.floor(frame)%row.frames.length],c=document.getElementById(side).getContext('2d');c.fillStyle='#08090e';c.fillRect(0,0,650,600);for(let i=0;i<d.geometry.length;i++){const [x,y]=d.geometry[i],r=a[i*3],g=a[i*3+1],b=a[i*3+2];c.fillStyle='rgb('+r+','+g+','+b+')';c.shadowColor=c.fillStyle;c.shadowBlur=18;c.beginPath();c.arc(55+x*540,50+(1-y)*500,4,0,Math.PI*2);c.fill()}c.shadowBlur=0;document.getElementById(side+'Stats').textContent='Mean RGB '+row.mean.toFixed(2)+' · fast '+row.fast.toFixed(2)+' · slow '+row.slow.toFixed(2)}seek.value=String(Math.floor(frame));document.getElementById('time').textContent=(frame/data.after.fps).toFixed(1)+' s'}
document.getElementById('play').onclick=function(){playing=!playing;this.textContent=playing?'Pause':'Play'};seek.oninput=()=>{frame=Number(seek.value);draw()};effect.onchange=scenario.onchange=()=>{frame=0;draw()};function tick(t){if(last&&playing)frame=(frame+(t-last)*data.after.fps/1000)%360;last=t;draw();requestAnimationFrame(tick)}requestAnimationFrame(tick);</script>`;
	mkdirSync(dirname(resolve(html)), { recursive: true });
	writeFileSync(html, page);
	console.log(resolve(html));
}
