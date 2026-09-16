// Gapless loop of one page with a click on every mark: the check that decides whether a mark is
// right. The loop runs on the buffer source itself, and clicks are scheduled a cycle ahead.

const CLICK_HZ = { kick: 660, snare: 990, hat: 1500, cymbal: 1980 };

export class Transport {
	constructor(audio) {
		this.audio = audio;
		this.run = null;
		this.pump = 0;
	}

	get playing() {
		return this.run !== null;
	}

	/** Where the playhead is in clip time. */
	position() {
		const run = this.run;
		if (!run) return null;
		const elapsed = (this.audio.currentTime - run.at) * run.rate;
		return elapsed < 0 ? run.from : run.from + (elapsed % (run.to - run.from));
	}

	play({ buffer, from, to, rate, gain, marks, active }) {
		this.stop();
		void this.audio.resume();
		const source = this.audio.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value = rate;
		source.loop = true;
		source.loopStart = from;
		source.loopEnd = to;
		const level = this.audio.createGain();
		level.gain.value = gain;
		source.connect(level).connect(this.audio.destination);
		const at = this.audio.currentTime + 0.08;
		source.start(at, from);
		const bus = this.audio.createGain();
		bus.connect(this.audio.destination);
		this.run = { at, from, to, rate, marks, active, source, bus, cycle: 0 };
		this.schedule();
		this.pump = setInterval(() => this.schedule(), 200);
	}

	stop() {
		clearInterval(this.pump);
		this.pump = 0;
		if (!this.run) return;
		const { source, bus } = this.run;
		this.run = null;
		try {
			source.stop();
		} catch {
			/* already ended */
		}
		bus.disconnect();
	}

	schedule() {
		const run = this.run;
		if (!run || !run.marks.length) return;
		const span = (run.to - run.from) / run.rate;
		while (run.at + run.cycle * span < this.audio.currentTime + 0.6) {
			const base = run.at + run.cycle * span;
			for (const mark of run.marks) {
				const when = base + (mark.t - run.from) / run.rate;
				if (when < this.audio.currentTime) continue;
				this.blip(when, CLICK_HZ[mark.cls], mark.cls === run.active ? 0.3 : 0.1);
			}
			run.cycle++;
		}
	}

	blip(when, hz, loud) {
		const osc = this.audio.createOscillator();
		const env = this.audio.createGain();
		osc.type = 'square';
		osc.frequency.value = hz;
		env.gain.setValueAtTime(0.0001, when);
		env.gain.exponentialRampToValueAtTime(loud, when + 0.001);
		env.gain.exponentialRampToValueAtTime(0.0001, when + 0.028);
		osc.connect(env).connect(this.run.bus);
		osc.start(when);
		osc.stop(when + 0.035);
	}
}
