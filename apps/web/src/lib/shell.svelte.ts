/**
 * Desktop injects hints before first paint; absent in browsers. Dynamic window-control spacing
 * uses --traffic-inset.
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

/** ffprobe ships with ffmpeg; explicit winget package IDs avoid ambiguous matches. */
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
