import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';
import { isContrast, isOutputBrightness, isOutputFps } from '$lib/hardware.ts';
import { DEFAULT_AMBIENT, type AmbientSettings, type ColourSource } from '@mv/core';
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

/** How output was set before it belonged to a room. Read once, to carry into the first room. */
const LEGACY_OUTPUT = [
	'outputOffsetMs',
	'outputFps',
	'outputBrightness',
	'outputContrast',
	'outputLampBrightness',
	'outputProtocol'
] as const;

export interface LegacyOutput {
	offsetMs?: number;
	fps?: number;
	brightness?: number;
	contrast?: number;
	lampBrightness?: number;
	protocol?: string;
}

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
	autopilot: boolean;
	lounge: boolean;
	rest: boolean;
	ambient: AmbientSettings;
}

class Settings {
	private cached: SettingsFile | null = null;
	private exists = false;
	private readonly listeners = new Set<Listener>();
	/** Writes land one after another, so two at once cannot race on the file. */
	private writing: Promise<unknown> = Promise.resolve();

	private async load(): Promise<SettingsFile> {
		if (this.cached) return this.cached;
		let raw: string;
		try {
			raw = await readFile(SETTINGS_FILE, 'utf8');
		} catch {
			return (this.cached = {});
		}
		this.exists = true;
		try {
			this.cached = JSON.parse(raw) as SettingsFile;
		} catch {
			// Kept beside the fresh file rather than written over, so nothing in it is lost.
			await rename(SETTINGS_FILE, `${SETTINGS_FILE}.unreadable-${Date.now()}`).catch(() => {});
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

	/**
	 * Output as it was set before rooms, or null for an installation that never ran. Taken once:
	 * the fields are dropped from the file as they move into the first room.
	 */
	async takeLegacyOutput(): Promise<LegacyOutput | null> {
		const file = (await this.load()) as SettingsFile & Record<string, unknown>;
		if (!this.exists) return null;
		const legacy: LegacyOutput = {
			offsetMs: typeof file.outputOffsetMs === 'number' ? file.outputOffsetMs : undefined,
			fps: isOutputFps(file.outputFps) ? file.outputFps : undefined,
			brightness: isOutputBrightness(file.outputBrightness) ? file.outputBrightness : undefined,
			contrast: isContrast(file.outputContrast) ? file.outputContrast : undefined,
			lampBrightness: isOutputBrightness(file.outputLampBrightness) ? file.outputLampBrightness : undefined,
			protocol: typeof file.outputProtocol === 'string' ? file.outputProtocol : undefined
		};
		if (LEGACY_OUTPUT.some((key) => key in file)) {
			const rest = { ...file };
			for (const key of LEGACY_OUTPUT) delete rest[key];
			await this.write(rest);
		}
		return legacy;
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
		await this.write(next);
		const published = await this.read();
		for (const listener of this.listeners) listener(published);
		return published;
	}

	private write(next: SettingsFile): Promise<void> {
		this.cached = next;
		const done = this.writing.then(async () => {
			await mkdir(CACHE_DIR, { recursive: true });
			const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
			await writeFile(tmp, JSON.stringify(next, null, '\t'), { mode: 0o600 });
			await rename(tmp, SETTINGS_FILE);
			this.exists = true;
		});
		this.writing = done.catch(() => {});
		return done;
	}

	/** Environment credentials override the stored key. */
	async provider(id: BackendId): Promise<{ provider: AuthorProvider } | { error: string }> {
		if (id === 'claude') return { provider: CLAUDE };
		const key = process.env.DEEPSEEK_API_KEY || (await this.load()).deepseekApiKey;
		if (!key) return { error: 'no DeepSeek API key; set DEEPSEEK_API_KEY before starting the app' };
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
