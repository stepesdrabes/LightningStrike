// Export synchronized audio and the actual room/lamp bytes for visual review.
// node bench/showreview.ts <track-id> [--cache DIR] [--out FILE]
// Optional: --before-core DIR --before-shows FILE --analysis FILE --show FILE --bars 0,62
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DEFAULT_ROOM, RoomDirector, buildGeometry, sectionBase, type TrackAnalysis, type TrackContext, type Show } from '@mv/core';
import { composeShow } from '@mv/author-engine';
import { benchmarkCache } from './cache.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const at = args.indexOf(`--${name}`);
	return at < 0 ? undefined : args[at + 1];
};
const id = args[0];
if (!id || id.startsWith('--')) throw new Error('Supply a cached track ID.');
const cache = benchmarkCache(flag('cache'));
const json = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const original = json<TrackAnalysis>(join(cache, `${id}.analysis.json`));
const analysis = flag('analysis') ? json<TrackAnalysis>(flag('analysis')!) : original;
const contextFile = join(cache, `${id}.context.json`);
const context = existsSync(contextFile) ? json<TrackContext>(contextFile) : null;
const meta = json<{ title: string; artHue?: number }>(join(cache, `${id}.meta.json`));
const show = flag('show') ? json<Show>(flag('show')!) : composeShow(analysis, { context, artHue: meta.artHue });
const audioFile = readdirSync(cache).find((f) => f.startsWith(`${id}.`) && /\.(mp3|m4a|wav|flac|opus|ogg|webm)$/i.test(f));
if (!audioFile) throw new Error(`No audio for ${id}`);
const g = buildGeometry(DEFAULT_ROOM);
const fps = 30;
const renderFps = 60;
const stride = g.count * 3 + 3;
const beforePath = flag('before-shows');
const beforeShow = beforePath ? json<Record<string, Show>>(beforePath)[id] : undefined;
const beforeCore = flag('before-core');
const BeforeDirector: typeof RoomDirector = beforeCore
	? (await import(pathToFileURL(resolve(beforeCore, 'director.ts')).href)).RoomDirector
	: RoomDirector;

function capture(a: TrackAnalysis, s: Show, at: number, seconds: number, Director = RoomDirector) {
	const d = new Director(g);
	d.load(a, s);
	const first = Math.round(at * renderFps);
	const count = Math.floor(seconds * fps);
	const bytes = Buffer.alloc(count * stride);
	const marks: number[][] = [];
	const levels: number[] = [];
	const lamp: number[] = [];
	let last: Uint8Array | null = null;
	let motion = 0;
	const sampleEvery = renderFps / fps;
	for (let n = 0; n < first + count * sampleEvery; n++) {
		const f = d.update(n / renderFps, 1 / renderFps, { playing: true, hasShow: true, lounge: false, rest: true });
		if (n < first) continue;
		if ((n - first) % sampleEvery !== 0) continue;
		const k = (n - first) / sampleEvery;
		bytes.set(d.bytes, k * stride);
		bytes.set(d.bounce, k * stride + g.count * 3);
		marks.push([f.kickEnv, f.snareEnv, f.hatEnv, f.barIndex]);
		let sum = 0;
		for (let p = 0; p < d.bytes.length; p += 3) {
			sum += Math.max(d.bytes[p], d.bytes[p + 1], d.bytes[p + 2]);
			if (last) for (let c = 0; c < 3; c++) motion += Math.abs(d.bytes[p + c] - last[p + c]);
		}
		last = Uint8Array.from(d.bytes);
		levels.push(sum / g.count);
		lamp.push(Math.max(...d.bounce));
	}
	const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / Math.max(1, values.length);
	const jumps: number[] = [];
	const ratios: number[] = [];
	const dips: number[] = [];
	const swings: number[] = [];
	for (const time of a.onsets.kick.times) {
		const index = Math.floor((time - 0.04 - at) * fps);
		if (index < 4 || index + 5 >= count) continue;
		const resting = mean(levels.slice(index - 4, index));
		const peak = Math.max(...levels.slice(index, index + 5));
		const trough = Math.min(...levels.slice(index, index + 5));
		jumps.push(peak - resting);
		ratios.push(peak / Math.max(1, resting));
		dips.push(Math.max(0, resting - trough));
		swings.push(Math.max(Math.abs(peak - resting), Math.abs(trough - resting)));
	}
	const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? 0;
	return { bytes: bytes.toString('base64'), marks, levels, lamp, motion: motion / Math.max(1, count - 1) / g.count / 3, mean: mean(levels), kickJump: median(jumps), kickRatio: median(ratios), kickDip: median(dips), kickSwing: median(swings), cues: s.cues };
}

const peak = analysis.sections.find((s) => sectionBase(s.kind) === 'drop');
const breakdown = analysis.sections.find((s) => s.kind === 'breakdown');
const requestedBars = flag('bars');
const clipLength = Number(flag('seconds') ?? 24);
if (!Number.isFinite(clipLength) || clipLength <= 0 || clipLength > 60) {
	throw new Error('--seconds must be between 0 and 60.');
}
const starts = requestedBars ? requestedBars.split(',').map((value) => {
	const bar = Number(value);
	const row = analysis.bars[bar];
	if (!Number.isInteger(bar) || bar < 0 || !row) throw new Error(`Invalid bar: ${value}`);
	const span = analysis.sections.find((s) => row.t >= s.startTime && row.t < s.endTime);
	return { name: `Bar ${bar} · ${row.section}`, at: row.t, end: span?.endTime ?? analysis.duration };
}) : [
	{ name: 'Opening', at: 0, end: analysis.sections[0]?.endTime ?? 24 },
	...(peak ? [{ name: 'First chorus / drop', at: peak.startTime, end: peak.endTime }] : []),
	...(breakdown ? [{ name: 'First breakdown', at: breakdown.startTime, end: breakdown.endTime }] : [])
];
const clips = starts.map(({ name, at, end }) => {
	const seconds = Math.min(clipLength, end - at, analysis.duration - at);
	const audio = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', join(cache, audioFile), '-t', String(seconds), '-vn', '-f', 'mp3', '-b:a', '128k', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
	if (audio.status !== 0) throw new Error(audio.stderr.toString());
	const after = capture(analysis, show, at, seconds);
	const before = beforeShow ? capture(original, beforeShow, at, seconds, BeforeDirector) : null;
	console.log(`${meta.title} ${name} @${at.toFixed(2)}: mean ${before?.mean.toFixed(1) ?? '?'} -> ${after.mean.toFixed(1)}, frame movement ${before?.motion.toFixed(2) ?? '?'} -> ${after.motion.toFixed(2)}`);
	console.log(`  Kick room lift ${before?.kickJump.toFixed(1) ?? '?'} -> ${after.kickJump.toFixed(1)} bytes; contrast ${before?.kickRatio.toFixed(2) ?? '?'} -> ${after.kickRatio.toFixed(2)}`);
	console.log(`  Kick room dip ${before?.kickDip.toFixed(1) ?? '?'} -> ${after.kickDip.toFixed(1)} bytes; absolute swing ${before?.kickSwing.toFixed(1) ?? '?'} -> ${after.kickSwing.toFixed(1)}`);
	const snares = analysis.onsets.snare.times.flatMap((t, i) =>
		t >= at && t < at + seconds ? [[t - at, analysis.onsets.snare.levels[i] ?? 1]] : []);
	return { name, at, seconds, audio: audio.stdout.toString('base64'), snares, before, after };
});

const payload = JSON.stringify({ title: meta.title, fps, stride, count: g.count, x: Array.from(g.x), y: Array.from(g.y), clips }).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LightningStrike listening review</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101216;color:#edeef4;font:15px system-ui,sans-serif}main{max-width:1360px;margin:30px auto;padding:0 24px}h1{font-size:25px;margin:5px 0 12px}p{color:#a7acb9;line-height:1.5}nav{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0}button,select{background:#242832;color:#edeef4;border:1px solid #414857;border-radius:7px;padding:9px 14px;font:inherit}button{cursor:pointer}button[aria-pressed=true]{background:#36516a;border-color:#6bb3d5}audio{height:40px;flex:1;min-width:300px}.rooms{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{background:#14171d;border:1px solid #303541;border-radius:12px;overflow:hidden}.panel h2{font-size:16px;margin:16px 18px 0}.panel canvas{display:block;width:100%;aspect-ratio:1.55}.cue{padding:0 18px 14px;color:#adb5c6;min-height:55px;font-size:13px;line-height:1.5}.timeline{width:100%;height:120px;border:1px solid #303541;border-radius:10px;margin-top:16px}#time{font:14px ui-monospace,monospace;color:#b8dcec;min-width:140px}.legend{font-size:13px}.kick{color:#eda363}.snare{color:#79b7f2}@media(max-width:800px){.rooms{grid-template-columns:1fr}main{padding:0 10px;margin-top:15px}}
</style>
<main><p>LightningStrike · listening review</p><h1 id="title"></h1><p>Compare the same passage through the original and polished renderers. The ceiling frame and corner lamp use the actual output bytes. Press play to hear the cached audio; the timeline shows detected drum envelopes.</p>
<nav><select id="clip" aria-label="Passage"></select><audio id="audio" controls></audio><span id="time"></span><button id="clicks" aria-pressed="false">Snare clicks off</button></nav>
<div class="rooms"><section class="panel" id="old"><h2>Before</h2><canvas id="before" width="960" height="620"></canvas><div class="cue" id="beforeCue"></div></section><section class="panel"><h2>Polished</h2><canvas id="after" width="960" height="620"></canvas><div class="cue" id="afterCue"></div></section></div>
<canvas id="timeline" class="timeline" width="1300" height="120"></canvas><p class="legend"><span class="kick">Kick</span> · <span class="snare">Snare / clap</span> · lower line: corner lamp · click the timeline to seek. Display brightness approximates emitted light; final room judgement belongs on the fixtures.</p></main>
<script type="application/json" id="data">${payload}</script>
<script>
const d=JSON.parse(document.getElementById('data').textContent), audio=document.getElementById('audio'), select=document.getElementById('clip');
document.getElementById('title').textContent=d.title;
for(let i=0;i<d.clips.length;i++){const o=document.createElement('option');o.value=i;o.textContent=d.clips[i].name;select.append(o)}
let clip,frame=0,clicks=false,audioContext,lastFrame=-1,lastAudioTime=0;
function unpack(s){if(s)s.pixels=Uint8Array.from(atob(s.bytes),c=>c.charCodeAt(0));return s}
for(const c of d.clips){unpack(c.before);unpack(c.after)}
function choose(){clip=d.clips[+select.value];audio.src='data:audio/mpeg;base64,'+clip.audio;document.getElementById('old').style.display=clip.before?'':'none';frame=0;lastFrame=-1;lastAudioTime=0;draw()}
select.onchange=choose;
const shade=v=>Math.round(255*Math.pow(v/255,1/2.2));
function project(x,y){return [480+x*150+y*46,255+y*95-x*22]}
function room(name,s){if(!s)return;const canvas=document.getElementById(name),ctx=canvas.getContext('2d');ctx.fillStyle='#101217';ctx.fillRect(0,0,960,620);
const n=Math.min(s.marks.length-1,frame),offset=n*d.stride,px=s.pixels;
let avg=[0,0,0];for(let p=0;p<d.count;p++)for(let c=0;c<3;c++)avg[c]+=px[offset+p*3+c]/d.count;
const wash=ctx.createRadialGradient(480,330,30,480,330,450);wash.addColorStop(0,'rgba('+avg.map(v=>shade(v)*.5).join(',')+',.45)');wash.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=wash;ctx.fillRect(0,0,960,620);
ctx.strokeStyle='#353a44';ctx.lineWidth=2;ctx.beginPath();for(const [i,[x,y]] of [[-2.5,-2],[2.5,-2],[2.5,2],[-2.5,2],[-2.5,-2]].entries()){const [a,b]=project(x,y);i?ctx.lineTo(a,b+70):ctx.moveTo(a,b+70)}ctx.stroke();
for(let p=0;p<d.count;p++){const [x,y]=project(d.x[p],d.y[p]);const values=[0,1,2].map(c=>shade(px[offset+p*3+c]));ctx.fillStyle='rgb('+values.join(',')+')';ctx.fillRect(x-2.3,y-2.3,4.6,4.6)}
const lamp=[0,1,2].map(c=>shade(px[offset+d.count*3+c])),[lx,ly]=project(-2.2,-1.7);const glow=ctx.createRadialGradient(lx,ly+135,0,lx,ly+135,130);glow.addColorStop(0,'rgba('+lamp.join(',')+',.7)');glow.addColorStop(1,'rgba('+lamp.join(',')+',0)');ctx.fillStyle=glow;ctx.fillRect(lx-130,ly+5,260,260);ctx.fillStyle='rgb('+lamp.join(',')+')';ctx.beginPath();ctx.ellipse(lx,ly+135,18,11,0,0,Math.PI*2);ctx.fill();
ctx.fillStyle='#9da8b9';ctx.font='18px system-ui';ctx.fillText('Corner lamp',lx-45,ly+190);
const bar=s.marks[n][3],cue=s.cues.filter(c=>c.bar<=bar).at(-1);document.getElementById(name+'Cue').textContent=cue?'Bar '+bar+' · '+cue.section+' · '+Object.values(cue.layers).map(l=>l.effect).join(' + '):'';
}
function timeline(){const c=document.getElementById('timeline'),x=c.getContext('2d'),s=clip.after;x.fillStyle='#14171d';x.fillRect(0,0,c.width,c.height);for(let p=0;p<c.width;p++){const n=Math.min(s.marks.length-1,Math.floor(p/c.width*s.marks.length));x.fillStyle='#eda363';x.fillRect(p,42-s.marks[n][0]*38,1,s.marks[n][0]*38);x.fillStyle='#79b7f2';x.fillRect(p,84-s.marks[n][1]*36,1,s.marks[n][1]*36);x.fillStyle='#c3a7dc';x.fillRect(p,117-s.lamp[n]/255*25,1,2)}x.fillStyle='#fff';x.fillRect(frame/s.marks.length*c.width,0,2,c.height)}
function draw(){room('before',clip.before);room('after',clip.after);timeline();document.getElementById('time').textContent=(clip.at+audio.currentTime).toFixed(2)+' s · bar '+clip.after.marks[Math.min(frame,clip.after.marks.length-1)][3]}
document.getElementById('timeline').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();audio.currentTime=(e.clientX-r.left)/r.width*clip.seconds};
document.getElementById('clicks').onclick=async e=>{clicks=!clicks;e.currentTarget.setAttribute('aria-pressed',clicks);e.currentTarget.textContent='Snare clicks '+(clicks?'on':'off');if(clicks){audioContext??=new AudioContext();await audioContext.resume()}};
function tick(){const time=audio.currentTime;frame=Math.min(clip.after.marks.length-1,Math.floor(time*d.fps));if(clicks&&!audio.paused&&time>lastAudioTime&&time-lastAudioTime<.1){for(const [at,level] of clip.snares){if(at<=lastAudioTime||at>time)continue;const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.frequency.value=1100;gain.gain.setValueAtTime(.09*Math.max(.15,level),audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.035);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.04)}}lastAudioTime=time;if(frame!==lastFrame){draw();lastFrame=frame}requestAnimationFrame(tick)}
choose();tick();
</script></html>`;
const out = resolve(flag('out') ?? `bench/reports/polish/${id}.html`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(out);
