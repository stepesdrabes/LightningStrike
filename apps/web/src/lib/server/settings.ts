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
	 * Store the key for desktop launches without shell credentials; cache is ignored and settings
	 * are loopback-only.
	 */
	deepseekApiKey?: string;
	/** Legacy backend preference, retained to migrate existing choices to authorModel. */
	authorBackend?: BackendId;
	/** One of `AUTHOR_MODELS`. The backend is whichever one it belongs to. */
	authorModel?: string;
	authorEffort?: EffortLevel;
	/** Installation output lead, milliseconds; positive compensates for transport/controller delay. */
	outputOffsetMs?: number;
	/** Frames a second on the wire. Belongs to the fixture, like the trim above it. */
	outputFps?: number;
	/**
	 * Installation tone curve: brightness dims after gamma; contrast sets the exponent and hit
	 * separation.
	 */
	outputBrightness?: number;
	outputContrast?: number;
	/** The lamp is a different fixture in a different corner, so it dims on its own. */
	outputLampBrightness?: number;
	/** Which wire the fixture is addressed on. Belongs to the installation too. */
	outputProtocol?: WireProtocol;
	/** Persist the host's radio preference in settings, outside the shared queue payload. */
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
	/** Send the model catalogue from the server so newly supported choices need no client copy. */
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

	/** Fall back to the default if a stored model ID is no longer offered. */
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

	/** Notify the server renderer directly so settings apply without an open browser. */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async update(patch: Partial<SettingsFile>): Promise<PublicSettings> {
		const next = { ...(await this.load()), ...patch };
		// An empty string clears the key; an absent patch field preserves it.
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

	/** Environment credentials override the stored key. */
	async provider(id: BackendId): Promise<{ provider: AuthorProvider } | { error: string }> {
		if (id === 'claude') return { provider: CLAUDE };
		const key = process.env.DEEPSEEK_API_KEY || (await this.load()).deepseekApiKey;
		if (!key) return { error: 'no DeepSeek API key is stored; add one in the show panel' };
		return { provider: deepseek(key) };
	}

	/** Resolve arbitrary requested IDs to catalogue models before constructing CLI arguments. */
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
