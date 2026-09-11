import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';

const ROOM_FILE = join(CACHE_DIR, 'room.json');

/** Human-readable Base32 room code excludes ambiguous characters. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 8;

function mintToken(): string {
	const bytes = randomBytes(TOKEN_LENGTH);
	let token = '';
	for (const byte of bytes) token += ALPHABET[byte % ALPHABET.length];
	return token;
}

/**
 * Prefer physical LAN interfaces by name; VPN/container addresses may be unreachable from
 * phones.
 */
export function lanAddress(): string | null {
	const candidates: { name: string; address: string }[] = [];
	for (const [name, addresses] of Object.entries(networkInterfaces())) {
		for (const entry of addresses ?? []) {
			if (entry.family !== 'IPv4' || entry.internal) continue;
			candidates.push({ name, address: entry.address });
		}
	}
	if (candidates.length === 0) return null;

	const rank = (name: string) => {
		if (/^en0$/.test(name) || /^Wi-Fi/i.test(name)) return 0;
		if (/^en\d+$/.test(name)) return 1;
		if (/^(wl|wlan|wlp)/.test(name)) return 1;
		if (/^Ethernet/i.test(name)) return 1;
		// Deprioritize bridges and tunnels case-insensitively, including Hyper-V vEthernet.
		if (/^(bridge|utun|feth|vmenet|docker|veth|tun|tap)/i.test(name)) return 9;
		return 5;
	};

	candidates.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
	return candidates[0].address;
}

interface RoomFile {
	token: string;
}

/** A rotatable shared room code limits guest access; holders retain access until rotation. */
class Room {
	private loading: Promise<string> | null = null;

	async currentToken(): Promise<string> {
		this.loading ??= this.load();
		return this.loading;
	}

	private async load(): Promise<string> {
		try {
			const raw = JSON.parse(await readFile(ROOM_FILE, 'utf8')) as RoomFile;
			if (typeof raw.token === 'string' && raw.token.length > 0) {
				return raw.token;
			}
		} catch {
			// No room yet, or one this version cannot read.
		}
		return this.persist(mintToken());
	}

	async rotate(): Promise<string> {
		const token = this.persist(mintToken());
		this.loading = token;
		return token;
	}

	private async persist(token: string): Promise<string> {
		await mkdir(CACHE_DIR, { recursive: true });
		const tmp = `${ROOM_FILE}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify({ token } satisfies RoomFile, null, '\t'));
		await rename(tmp, ROOM_FILE);
		return token;
	}

	/** Constant time, so a wrong token cannot be narrowed down one character at a time. */
	async accepts(candidate: string | null | undefined): Promise<boolean> {
		if (!candidate) return false;
		const token = await this.currentToken();
		const a = Buffer.from(token);
		const b = Buffer.from(candidate);
		return a.length === b.length && timingSafeEqual(a, b);
	}
}

export const room = new Room();
