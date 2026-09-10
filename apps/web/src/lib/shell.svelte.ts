/**
 * What the desktop shell tells the page about itself.
 *
 * Injected as a global before any of the page's own script runs, rather than fetched, so the
 * first paint already has it. Absent in a browser, which is the whole point: the same build
 * serves both.
 *
 * The space the window controls need is not here: it changes when the window goes fullscreen,
 * so the shell pushes it as the --traffic-inset custom property instead.
 */
export interface ShellHints {
	desktop: boolean;
	platform: string;
	/** Command-line tools the analysis pipeline needs that are not on PATH. */
	missingTools: string[];
}

const NONE: ShellHints = { desktop: false, platform: 'web', missingTools: [] };

declare global {
	interface Window {
		__LIGHTNINGSTRIKE__?: Partial<ShellHints>;
	}
}

export function readShell(): ShellHints {
	if (typeof window === 'undefined') return NONE;
	const given = window.__LIGHTNINGSTRIKE__;
	if (!given?.desktop) return NONE;
	return {
		desktop: true,
		platform: given.platform ?? 'unknown',
		missingTools: given.missingTools ?? []
	};
}

/**
 * What each tool is packaged as, which is not always its own name: ffprobe ships inside
 * ffmpeg, and a bare name leaves winget asking which of several matches was meant.
 */
const WINGET: Record<string, string> = {
	ffmpeg: 'Gyan.FFmpeg',
	ffprobe: 'Gyan.FFmpeg',
	'yt-dlp': 'yt-dlp.yt-dlp'
};

/** How to install what is missing, on the platform it is missing from. */
export function installHint(platform: string, tools: string[]): string {
	const list = tools.join(' ');
	if (platform === 'macos') return `brew install ${list}`;
	if (platform === 'windows') {
		const ids = [...new Set(tools.map((tool) => WINGET[tool] ?? tool))];
		return `winget install ${ids.join(' ')}`;
	}
	return `Install ${list} with your package manager.`;
}
