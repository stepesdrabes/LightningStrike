import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';

const ROOM_FILE = join(CACHE_DIR, 'room.json');

/**
 * Short enough to be typed off a screen by someone whose phone will not scan, long enough
 * that guessing it is not worth anyone's evening. Base32 without the letters that look like
 * digits, so reading it aloud across a room works.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 8;

function mintToken(): string {
	const bytes = randomBytes(TOKEN_LENGTH);
	let token = '';
	for (const byte of bytes) token += ALPHABET[byte % ALPHABET.length];
	return token;
}

/**
 * The address a phone on the same network should be sent to.
 *
 * A machine reports several: virtual interfaces from VPNs and container bridges answer the
 * same query as the WiFi card, and a QR pointing at one of those is unreachable from a phone.
 * Preferring the interface the default route would use is not available here without probing,
 * so this ranks by name instead: en0 is the WiFi on every Mac, and Windows reports the two
 * real cards under names a person would recognise.
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
		// Bridges, VPN tunnels and container networks answer but cannot be reached from a phone.
		// Case-insensitively, so `veth` also catches Hyper-V's `vEthernet (WSL)`.
		if (/^(bridge|utun|feth|vmenet|docker|veth|tun|tap)/i.test(name)) return 9;
		return 5;
	};

	candidates.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
	return candidates[0].address;
}

interface RoomFile {
	token: string;
}

/**
 * The shared secret that turns "on this WiFi" into "was in this room".
 *
 * Not authentication: it stops someone already on the network finding the queue by scanning
 * ports, and it gives a way to end an evening's access without changing the network. Anyone
 * who has the code has it until it is rotated, which is exactly how a door key behaves.
 */
class Room {
	private token: string | null = null;
	private loading: Promise<string> | null = null;

	async currentToken(): Promise<string> {
		this.loading ??= this.load();
		return this.loading;
	}

	private async load(): Promise<string> {
		try {
			const raw = JSON.parse(await readFile(ROOM_FILE, 'utf8')) as RoomFile;
			if (typeof raw.token === 'string' && raw.token.length > 0) {
				this.token = raw.token;
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
		this.token = token;
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
