// node bench/lab/summarize-ort-profile.ts path/to/drums_TIMESTAMP.json
import { readFileSync } from 'node:fs';
const events = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const operations = new Map<string, { calls: number; microseconds: number }>();
const providers = new Map<string, { calls: number; microseconds: number }>();
for (const event of events) {
 if (event.cat !== 'Node' || !event.name?.endsWith('_kernel_time') || !Number.isFinite(event.dur)) continue;
 const provider = event.args?.provider ?? 'unknown';
 const operation = `${provider}/${event.args?.op_name ?? event.name}`;
 for (const [map, key] of [[operations, operation], [providers, provider]] as const) {
  const tally = map.get(key) ?? { calls: 0, microseconds: 0 };
  tally.calls++; tally.microseconds += event.dur; map.set(key, tally);
 }
}
const table = (map: Map<string, { calls: number; microseconds: number }>) => [...map]
 .sort((a, b) => b[1].microseconds - a[1].microseconds)
 .map(([name, value]) => ({ name, calls: value.calls, milliseconds: value.microseconds / 1000 }));
console.log(JSON.stringify({ note: 'Recorded kernel durations, not wall time; GPU providers may report host dispatch durations.',
 providers: table(providers), operations: table(operations).slice(0, 30) }, null, 2));
