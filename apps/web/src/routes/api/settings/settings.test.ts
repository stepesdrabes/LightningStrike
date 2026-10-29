import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT } from './+server.ts';

const mocks = vi.hoisted(() => ({
	choices: vi.fn(), read: vi.fn(), update: vi.fn(), stale: vi.fn(), pump: vi.fn()
}));
vi.mock('@mv/analysis', () => ({ analysisModelChoices: mocks.choices }));
vi.mock('@mv/author-ai', () => ({ authorModel: () => undefined, isEffort: () => false }));
// The test runner does not resolve SvelteKit's $lib alias, so each module is named for it.
vi.mock('$lib/hardware.ts', () => import('../../../lib/hardware.ts'));
vi.mock('$lib/ambient.ts', () => import('../../../lib/ambient.ts'));
vi.mock('$lib/server/access.ts', () => ({ isLocal: () => true }));
vi.mock('$lib/server/settings.ts', () => ({ settings: { read: mocks.read, update: mocks.update } }));
vi.mock('$lib/server/queueStore.ts', () => ({ queue: { prepareStaleAgain: mocks.stale } }));
vi.mock('$lib/server/ingestRunner.ts', () => ({ runner: { pump: mocks.pump } }));

const SMALL_MISSING = 'Striker 2.0 Small is not installed: put striker2-small.onnx and striker2-small.json in /models.';

function choices(small: string | null) {
	return [
		{ id: 'striker2', label: 'Striker 2.0', name: 'Striker 2.0 (1254cace)', problem: null },
		{ id: 'striker2-small', label: 'Striker 2.0 Small', name: small, problem: small ? null : SMALL_MISSING }
	];
}

function put(body: unknown) {
	const request = new Request('http://localhost/api/settings', {
		method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
	});
	return PUT({ request } as Parameters<typeof PUT>[0]);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.read.mockResolvedValue({ analysisModel: 'striker2' });
	mocks.update.mockImplementation(async (patch: { analysisModel?: string }) => ({ analysisModel: patch.analysisModel ?? 'striker2' }));
});

describe('choosing the analysis model', () => {
	it('refuses a model that is not installed, saying what is missing', async () => {
		mocks.choices.mockResolvedValue(choices(null));
		await expect(put({ analysisModel: 'striker2-small' })).rejects.toMatchObject({
			status: 409, body: { message: SMALL_MISSING }
		});
		await expect(put({ analysisModel: 'striker3' })).rejects.toMatchObject({ status: 400 });
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('switches to an installed model and puts songs the other made back in line', async () => {
		mocks.choices.mockResolvedValue(choices('Striker 2.0 Small (5a1100aa)'));
		const response = await put({ analysisModel: 'striker2-small' });
		expect(await response.json()).toEqual({ analysisModel: 'striker2-small' });
		expect(mocks.update).toHaveBeenCalledWith({ analysisModel: 'striker2-small' });
		expect(mocks.stale).toHaveBeenCalledOnce();
		expect(mocks.pump).toHaveBeenCalledOnce();
	});

	it('leaves the queue alone when the model stays', async () => {
		mocks.choices.mockResolvedValue(choices(null));
		await put({ analysisModel: 'striker2' });
		expect(mocks.stale).not.toHaveBeenCalled();
	});
});
