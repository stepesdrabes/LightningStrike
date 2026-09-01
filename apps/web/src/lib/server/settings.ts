import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';
import {
	DEFAULT_OUTPUT_FPS,
	isContrast,
	isOutputBrightness,
	isOutputFps,
	isWireProtocol,
	type WireProtocol
} from '$lib/hardware.ts';
import { DEFAULT_AMBIENT, GAMMA, MASTER, type AmbientSettings, type ColourSource } from '@mv/core';
import {
	AUTHOR_MODELS,
	CLAUDE,
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	authorModel,
	deepseek,
	isEffort,
	type AuthorModel,
	type AuthorProvider,
	type BackendId,
	type EffortLevel
} from '@mv/author-ai';

const SETTINGS_FILE = join(CACHE_DIR, 'settings.json');

type Listener = (settings: PublicSettings) => void;

interface SettingsFile {
	/**
	 * A DeepSeek platform key, kept here rather than in the environment because the desktop
	 * build launches without a shell to inherit one from. `cache/` is gitignored and the
	 * settings API is loopback-only, which is the same boundary the hardware and the queue sit
	 * behind: anyone who can reach loopback on this machine is already sitting at it.
	 */
	deepseekApiKey?: string;
	/**
	 * Which backend the authoring button spends.
	 *
	 * Superseded by `authorModel`, which names one of them exactly. Still read, so a machine
	 * that chose DeepSeek before the models were nameable keeps its choice.
	 */
	authorBackend?: BackendId;
	/** One of `AUTHOR_MODELS`. The backend is whichever one it belongs to. */
	authorModel?: string;
	authorEffort?: EffortLevel;
	/**
	 * How far ahead of the audio the strips are driven, milliseconds.
	 *
	 * DDP and WLED add transport delay the compiler cannot know, and it varies with the board,
	 * the network and the controller. So it belongs to the installation rather than to a track,
	 * and it is dialled by eye against the real room. Positive runs the room early.
	 */
	outputOffsetMs?: number;
	/** Frames a second on the wire. Belongs to the fixture, like the trim above it. */
	outputFps?: number;
	/**
	 * The two ends of the tone curve, dialled against the real room and belonging to it.
	 *
	 * How bright a fixture reads is a property of how much strip is hanging and how big the space
	 * is, not of the show, so it cannot be authored. `outputBrightness` is a dimmer applied after
	 * gamma and costs no contrast; `outputContrast` is the exponent, which is what decides whether
	 * a hit has anything to be brighter than.
	 */
	outputBrightness?: number;
	outputContrast?: number;
	/** The lamp is a different fixture in a different corner, so it dims on its own. */
	outputLampBrightness?: number;
	/** Which wire the fixture is addressed on. Belongs to the installation too. */
	outputProtocol?: WireProtocol;
	/**
	 * Whether the radio keeps the queue from running out.
	 *
	 * Here rather than on the queue, which is broadcast to every phone in the room and rebuilt
	 * field by field when it is loaded, so a flag on it would quietly vanish on a restart. This
	 * is a preference of the machine running the night, and it sits behind the same loopback
	 * boundary as the hardware.
	 */
	autopilot?: boolean;
	/** Calm scenes instead of the authored show, while a track is playing. */
	lounge?: boolean;
	/** Whether the room drifts into ambient when nothing is playing, rather than freezing. */
	rest?: boolean;
	/** Where the resting room's colour comes from. */
	ambientColour?: ColourSource;
	/** Textbook HSV degrees, 0-359, as picked on the wheel. */
	ambientHue?: number;
	ambientSat?: number;
	/** Degrees a minute, in `drift`. */
	ambientDrift?: number;
	/** Seconds a scene holds when nothing is playing. */
	ambientDwell?: number;
}

export interface PublicSettings {
	/** Never the key itself. Whether one is stored is all the interface needs to know. */
	hasDeepseekKey: boolean;
	/** Derived from `authorModel`, so nothing downstream has to know a model to name a desk. */
	authorBackend: BackendId;
	authorModel: string;
	authorEffort: EffortLevel;
	/**
	 * The catalogue itself, rather than a copy of it kept in the browser by hand.
	 *
	 * Every other cross-boundary type in this app is mirrored in `lib/types.ts` on purpose, but
	 * this is data rather than a shape: a model added to `AUTHOR_MODELS` should appear in the
	 * menu without a second edit, and a stale duplicate here would offer a model the server
	 * would then refuse.
	 */
	authorModels: readonly AuthorModel[];
	outputOffsetMs: number;
	outputFps: number;
	outputBrightness: number;
	outputContrast: number;
	outputLampBrightness: number;
	outputProtocol: WireProtocol;
	autopilot: boolean;
	lounge: boolean;
	rest: boolean;
	ambient: AmbientSettings;
}

class Settings {
	private cached: SettingsFile | null = null;
	private readonly listeners = new Set<Listener>();

	private async load(): Promise<SettingsFile> {
		if (this.cached) return this.cached;
		try {
			this.cached = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as SettingsFile;
		} catch {
			this.cached = {};
		}
		return this.cached;
	}

	/**
	 * The model this machine authors with.
	 *
	 * A stored id that is no longer offered falls back to the default rather than being kept,
	 * because the alternative is a button that spends nothing and a 400 nobody expected.
	 */
	private modelIn(file: SettingsFile): AuthorModel {
		const stored = authorModel(file.authorModel);
		if (stored) return stored;
		const legacy = AUTHOR_MODELS.find((m) => m.backend === file.authorBackend);
		return legacy ?? authorModel(DEFAULT_MODEL)!;
	}

	async read(): Promise<PublicSettings> {
		const file = await this.load();
		const model = this.modelIn(file);
		return {
			hasDeepseekKey: typeof file.deepseekApiKey === 'string' && file.deepseekApiKey.length > 0,
			authorBackend: model.backend,
			authorModel: model.id,
			authorEffort: file.authorEffort ?? DEFAULT_EFFORT,
			authorModels: AUTHOR_MODELS,
			outputOffsetMs: file.outputOffsetMs ?? 0,
			outputFps: isOutputFps(file.outputFps) ? file.outputFps : DEFAULT_OUTPUT_FPS,
			outputBrightness: isOutputBrightness(file.outputBrightness)
				? file.outputBrightness
				: MASTER,
			outputContrast: isContrast(file.outputContrast) ? file.outputContrast : GAMMA,
			outputLampBrightness: isOutputBrightness(file.outputLampBrightness)
				? file.outputLampBrightness
				: MASTER,
			outputProtocol: isWireProtocol(file.outputProtocol) ? file.outputProtocol : 'ddp',
			autopilot: file.autopilot ?? false,
			lounge: file.lounge ?? false,
			// On by default. A room that holds its last cue forever after the music stops is the
			// behaviour this replaced, not a preference anyone would choose from scratch.
			rest: file.rest ?? true,
			ambient: {
				source: file.ambientColour ?? DEFAULT_AMBIENT.source,
				hue: file.ambientHue ?? DEFAULT_AMBIENT.hue,
				sat: file.ambientSat ?? DEFAULT_AMBIENT.sat,
				drift: file.ambientDrift ?? DEFAULT_AMBIENT.drift,
				dwell: file.ambientDwell ?? DEFAULT_AMBIENT.dwell
			}
		};
	}

	/** Read on the hot path, where the caller only wants the one answer. */
	async autopilotOn(): Promise<boolean> {
		return (await this.load()).autopilot ?? false;
	}

	/**
	 * Told when anything changes, so the server's own renderer follows a switch without a browser
	 * having to relay it. The hardware keeps running with no tab open, and so must the decision
	 * about what it is running.
	 */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async update(patch: Partial<SettingsFile>): Promise<PublicSettings> {
		const next = { ...(await this.load()), ...patch };
		// An empty string is how the interface says "forget it", which is not the same as the
		// key being absent from a partial update.
		if (patch.deepseekApiKey === '') delete next.deepseekApiKey;
		this.cached = next;

		await mkdir(CACHE_DIR, { recursive: true });
		const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(next, null, '\t'), { mode: 0o600 });
		await rename(tmp, SETTINGS_FILE);

		const published = await this.read();
		for (const listener of this.listeners) listener(published);
		return published;
	}

	/**
	 * The backend to author with, or why it cannot be.
	 *
	 * An environment variable wins over the stored key, so a dev machine can point at a
	 * different account without editing anything the app also writes to.
	 */
	async provider(id: BackendId): Promise<{ provider: AuthorProvider } | { error: string }> {
		if (id === 'claude') return { provider: CLAUDE };
		const key = process.env.DEEPSEEK_API_KEY || (await this.load()).deepseekApiKey;
		if (!key) return { error: 'no DeepSeek API key is stored; add one in the show panel' };
		return { provider: deepseek(key) };
	}

	/**
	 * The whole authoring choice, resolved: which desk, which model, how hard it thinks.
	 *
	 * `asked` is whatever the request named, which may be nothing and may be a model this build
	 * does not offer. Either way what comes back is a model on the list, so nothing downstream
	 * has to defend against a free string reaching the CLI.
	 */
	async authoring(
		asked?: string | null,
		effortAsked?: string | null
	): Promise<
		{ provider: AuthorProvider; model: string; effort: EffortLevel } | { error: string }
	> {
		const file = await this.load();
		const model = authorModel(asked ?? undefined) ?? this.modelIn(file);
		const chosen = await this.provider(model.backend);
		if ('error' in chosen) return chosen;
		return {
			provider: chosen.provider,
			model: model.id,
			effort: isEffort(effortAsked) ? effortAsked : (file.authorEffort ?? DEFAULT_EFFORT)
		};
	}
}

export const settings = new Settings();
