// Manually judged rap/EDM kit hits (experiment F). Verdicts are hand-written from the
// audibility reports and band curves; the numeric fields are pulled from those files so the
// fixtures stay tied to the evidence.
//   node bench/lab/judged.ts
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bandRises, cachedLevel, curveMax, load, modelAct, type Kit, type Report } from './spotcheck.ts';

const LAB = resolve(import.meta.dirname, '..', '..', 'bench', 'reports', 'audio-reliability', 'lab');

type Verdict = 'true-hit' | 'false-hit' | 'missed-hit';
type Confidence = 'high' | 'medium' | 'low';
interface Judgement { id: string; time: number; cls: Kit; verdict: Verdict; confidence: Confidence; evidence: string }

const J = (id: string, time: number, cls: Kit, verdict: Verdict, confidence: Confidence, evidence: string): Judgement =>
	({ id, time, cls, verdict, confidence, evidence });

/** Detector paths: model = ADTOF class (shipped for kick/snare), dsp = detectDrums (shipped for hat). */
const JUDGED: Judgement[] = [
	// The Box (808 rap, 117 bpm, half-time snare on beat 3)
	J('IxJjY5T9yag', 19.941, 'kick', 'true-hit', 'high', '808 with attack: low band +27 dB, model kick 0.87, DSP kick 1.0, shipped 1.00'),
	J('IxJjY5T9yag', 27.637, 'snare', 'true-hit', 'high', 'Trap snare on beat 3: crack +14 dB, body +6, low -1 (thin, bodyless); model 0.74, shipped 0.87'),
	J('IxJjY5T9yag', 23.536, 'snare', 'missed-hit', 'medium', 'Beat 3 of bar 9 (4th bar of the loop, also bars 13 and 17): crack +16 dB like the true snares, DSP snare 0.83, but model snare 0.02 so only a kick (0.95) ships'),
	J('IxJjY5T9yag', 27.290, 'hat', 'missed-hit', 'high', '32nd-note hat roll 27.24-27.55 s: air +8 dB per tick, model hat 0.41, DSP curve 0.48 without a picked peak; the cache ships 1 of 5 roll ticks (an invented 0.26 at 27.39)'),
	J('IxJjY5T9yag', 28.403, 'hat', 'true-hit', 'high', 'Closed hat on the 8th: air +37 dB, decay 30 ms; model 0.64, DSP 1.0, shipped 1.00'),
	J('IxJjY5T9yag', 23.290, 'hat', 'true-hit', 'high', 'Hat the DSP picker dropped under the 808 (curve 0.52, no peak); quantise invented it at 0.26 and the audio agrees: air +13, crack +14, model hat 0.48'),
	J('IxJjY5T9yag', 18.920, 'kick', 'true-hit', 'low', '808 re-trigger while the previous note sustains: low band rises only +2.6 dB, but the slot (beat 2 of bars 7, 11, 15) carries the same hit in every loop repeat (model 0.55/0.32/0.18); shipped 0.62'),
	// SICKO MODE intro (no drums until the beat switch)
	J('NQbkGDoD7B0', 30.460, 'hat', 'false-hit', 'medium', 'DSP hat 1.0 on a bright burst (air +18 dB, crack +4) at an off-grid position (17+1.32); model hat 0.00; consistent with rap sibilance, not a programmed hat; shipped 1.00'),
	J('NQbkGDoD7B0', 37.316, 'hat', 'false-hit', 'medium', 'DSP hat 1.0, model 0.00, air +17 crack +8, off-grid 21+1.34; shipped 1.00'),
	J('NQbkGDoD7B0', 41.093, 'hat', 'false-hit', 'medium', 'DSP hat 0.45, model 0.00, air +19 crack +11, off-grid 23+1.73; shipped 0.45'),
	// Habibi (disco/pop 147 bpm, chorus at bar 8)
	J('tWEaUKCQ8Fg', 14.094, 'snare', 'false-hit', 'medium', 'Off-beat 8th with no transient: every band rises <7 dB (crack +4, air +3) while the neighbouring off-beats show crack +15/air +14-30; model snare 0.65, shipped 0.79'),
	J('tWEaUKCQ8Fg', 16.953, 'snare', 'true-hit', 'medium', 'Off-beat clap/snare: crack +24, air +30, body +6; model 0.41, DSP 0.67, shipped 0.31'),
	J('tWEaUKCQ8Fg', 29.840, 'kick', 'false-hit', 'high', 'Invented duplicate 46 ms after the real kick at 29.794 (0.97): model 0.02 here; the beat grid sits ~60 ms early against the kicks in bars 16-18, so the pattern vote asks for slot .25 next to the detected slot .0; shipped 0.26'),
	J('tWEaUKCQ8Fg', 28.630, 'kick', 'false-hit', 'high', 'Invented duplicate 61 ms after the kick at 28.569 (0.72); model 0.00; same grid-offset cause; shipped 0.16'),
	J('tWEaUKCQ8Fg', 13.055, 'kick', 'true-hit', 'high', 'Pickup kick into the chorus: low +7.5, body +12; model 0.37, DSP 0.28, shipped 0.20'),
	J('tWEaUKCQ8Fg', 15.515, 'kick', 'true-hit', 'medium', 'Four-on-the-floor kick over a sustained bass: low +4 dB only, air +16; model 0.73, DSP 0.84, shipped 0.83'),
	// Desire (trance build and drop, 138 bpm)
	J('UARSiWU8eoo', 40.911, 'snare', 'true-hit', 'high', 'EDM clap on beat 4: body +9, crack +12, air +12; model 0.81, DSP 0.82, shipped 1.00'),
	J('UARSiWU8eoo', 33.849, 'snare', 'missed-hit', 'medium', 'Build roll: 16th-note noise bursts, every band +9-12 dB, decay 60 ms; model snare 0.01, DSP 0.03; nothing shipped in bars 18-21 (may be an acceptable omission for a roll)'),
	J('UARSiWU8eoo', 46.020, 'hat', 'false-hit', 'high', 'Model hat 0.47 one 16th before the kick (25+2.90) where nothing attacks: crack -2, air -3 (sidechain swell / bass); DSP 0.00; not shipped'),
	J('UARSiWU8eoo', 54.280, 'hat', 'false-hit', 'high', 'Model hat 0.60 at 30+1.89, air -2 crack -1; same pre-kick pattern; not shipped'),
	J('UARSiWU8eoo', 41.991, 'hat', 'true-hit', 'high', 'Off-beat open hat: air +29, crack +13; model 0.66, DSP 1.0, shipped 1.00'),
	J('UARSiWU8eoo', 39.602, 'kick', 'true-hit', 'high', 'First kick of the drop: low +52 dB; model 0.83, shipped 0.90'),
	// Sunset (house drop, 125 bpm)
	J('bEgS_KJCxTU', 113.759, 'snare', 'true-hit', 'high', 'House clap on beat 2: body +9, crack +15, air +14, low +1; model 0.62, DSP 1.0, shipped 0.67'),
	J('bEgS_KJCxTU', 98.398, 'kick', 'true-hit', 'medium', 'Kick on beat 2, 130 ms after a bass stab that is still sounding: low band rises only +1.5 dB, crack +19; model 0.78, shipped 0.89; every other beat in the bar carries low +20-24'),
	J('bEgS_KJCxTU', 101.630, 'hat', 'false-hit', 'high', 'Model hat 0.31 on a bass note (low +8, body +14, air -1); DSP 0.00; not shipped'),
	J('bEgS_KJCxTU', 113.040, 'hat', 'true-hit', 'high', 'Off-beat hat: air +21, crack +15; DSP 1.0, shipped 1.00, model 0.46'),
	// Summertime Sadness hardstyle (167 bpm)
	J('AHaIdOXzzuE', 28.384, 'snare', 'false-hit', 'medium', 'Every beat of bars 18-23 ships a snare (0.2-0.97) and no kick: crack +10, air +11, low +1.5. The same click element continues into the drop where the low band bumps +6-9 dB per beat, i.e. a high-passed hardstyle kick, not a clap (alternative reading: clap on every beat)'),
	J('AHaIdOXzzuE', 28.384, 'kick', 'missed-hit', 'medium', 'Same event: model kick 0.03, DSP kick 0.00, nothing shipped; the kick class only wakes up (0.3-0.8) once the low end opens at 35 s'),
	J('AHaIdOXzzuE', 37.724, 'snare', 'false-hit', 'medium', 'Drop: kick 0.40 and snare 0.83 fire on the same hit every beat; low +8 (kick tail bump), crack +12, air +11; shipped snare 0.99 next to a shipped kick of 0.27'),
	J('AHaIdOXzzuE', 37.724, 'kick', 'true-hit', 'high', 'Hardstyle kick on the beat (low +8 dB bump on every beat of the drop), but the shipped level is only 0.27 because the model splits the hit between kick 0.40 and snare 0.83'),
	J('AHaIdOXzzuE', 26.108, 'kick', 'false-hit', 'high', 'DSP kick 0.70 on a bass note: low +4.5, body +0.1, no click; model 0.00; not shipped (model kick is the shipped stream)'),
	// Hedex MHITR (drum and bass, 175 bpm)
	J('mbWOIqlrqFU', 36.401, 'kick', 'true-hit', 'high', 'Four-to-the-floor section of the drop: low +30 dB on every beat; model 0.84, shipped 0.94'),
	J('mbWOIqlrqFU', 36.401, 'snare', 'true-hit', 'low', 'Same hit also ships as snare 1.00 (model 0.89): body +17, crack +10, air +15. The 2-step section shows the snare sample itself carries low +33 (53.202), so kick and snare are layered in this track; the evidence cannot separate a layered hit from a double fire'),
	J('mbWOIqlrqFU', 52.515, 'snare', 'true-hit', 'high', '2-step backbeat: body +24, crack +8, kick class 0.01; model 0.89, DSP 0.98, shipped 1.00'),
	J('mbWOIqlrqFU', 53.026, 'kick', 'true-hit', 'high', 'Kick on the and of 3: low +47 dB, snare class 0.05; model 0.75, shipped 0.82'),
	J('mbWOIqlrqFU', 36.915, 'hat', 'true-hit', 'high', 'Off-beat hat: air +11, crack +7; DSP 0.95, shipped 0.97, model 0.37'),
	// Vandr (rock, 171 bpm)
	J('cOpRvLUSMiQ', 8.725, 'snare', 'true-hit', 'high', 'Backbeat: body +19, crack +11; model 0.92, DSP 1.0, shipped 1.00'),
	J('cOpRvLUSMiQ', 8.904, 'kick', 'true-hit', 'high', 'Kick on the and of 2: low +7.5; model 0.89, DSP 0.67, shipped 0.97'),
	J('cOpRvLUSMiQ', 10.072, 'hat', 'false-hit', 'medium', 'DSP hat 1.0 off the 8th grid (7+0.83) with body +9 and air +7.5: guitar/cymbal wash rather than a hat; model 0.01; shipped 1.00'),
	J('cOpRvLUSMiQ', 9.422, 'snare', 'true-hit', 'high', 'Backbeat: body +18, crack +10; model 0.88, shipped 0.93'),
	// Spend Dat (trap, 90 bpm)
	J('yynqCKDI7kQ', 10.130, 'kick', 'false-hit', 'high', 'Kick class 0.41 on the beat-4 snare (snare 0.80, body +16, crack +15, air +25) with no low transient (low +0.3); shipped kick 0.49 next to the shipped snare 0.89'),
	J('yynqCKDI7kQ', 9.463, 'kick', 'true-hit', 'high', '808 with attack: low +59 dB; model 0.78, shipped 0.91'),
	J('yynqCKDI7kQ', 6.129, 'snare', 'true-hit', 'high', 'Trap snare/clap on beat 2: body +14, crack +34, low -2; model 0.88, DSP 0.91, shipped 0.98'),
	J('yynqCKDI7kQ', 9.967, 'hat', 'true-hit', 'high', 'Hat tick: air +14; model 0.41, DSP 0.42, shipped 0.41'),
	J('yynqCKDI7kQ', 7.973, 'kick', 'true-hit', 'high', 'Off-grid 808 (2+3.73): low +21 dB; model 0.39, DSP 0.36, shipped 0.45'),
	// Doppler (techno, 135 bpm, straight 16th hats)
	J('-5XxjPOedc0', 70.478, 'hat', 'missed-hit', 'high', 'Closed 16th hat: crack +26, air +23 dB; model hat 0.42 but DSP curve 0.08 (the off-beat open hat at +38 dB sets the normalisation); nothing shipped on any 16th, only the off-beat 8ths'),
	J('-5XxjPOedc0', 72.690, 'hat', 'missed-hit', 'high', 'Closed 16th hat: crack +24, air +23; model 0.38, DSP 0.09, not shipped'),
	J('-5XxjPOedc0', 71.147, 'hat', 'missed-hit', 'high', 'Closed hat one 16th before the kick: crack +13, air +13; model 0.58, DSP 0.07, not shipped'),
	J('-5XxjPOedc0', 71.030, 'hat', 'true-hit', 'high', 'Off-beat open hat: crack +38, air +39; DSP 0.77, shipped 0.77, model 0.58'),
	J('-5XxjPOedc0', 71.244, 'kick', 'true-hit', 'high', 'Four-on-the-floor kick: low +7.5 over a sustained bass, body +25; model 0.63, shipped 0.64'),
	J('-5XxjPOedc0', 71.244, 'snare', 'false-hit', 'high', 'DSP snare 1.0 on every kick (body and crack both rise with the kick); model snare 0.04, so nothing ships; a DSP-only fallback would put a snare on every beat')
];

/** Loud events that must stay absent from the kick stream. */
const NON_HITS = [
	{ id: 'bEgS_KJCxTU', time: 98.271, cls: 'kick' as Kit, evidence: 'Bass stab one 16th before beat 2: low +22, body +15, crack -8, air -9; model kick 0.02, DSP kick 0.00, nothing shipped; the kick follows 130 ms later' },
	{ id: 'bEgS_KJCxTU', time: 113.629, cls: 'kick' as Kit, evidence: 'Bass stab: low +31, body +20, crack +2; model 0.01, DSP 0.00' },
	{ id: 'bEgS_KJCxTU', time: 115.550, cls: 'kick' as Kit, evidence: 'Bass stab: low +29, body +21, crack +0; model 0.02, DSP 0.00' },
	{ id: 'NQbkGDoD7B0', time: 27.710, cls: 'kick' as Kit, evidence: 'Bar 16 start, 808 bass note without attack: low +2.9 dB over 50 ms; no kick from model, DSP or cache (correct)' },
	{ id: 'NQbkGDoD7B0', time: 29.440, cls: 'kick' as Kit, evidence: 'Bar 17 start, bass note: low +3.9; nothing fires (correct)' },
	{ id: 'IxJjY5T9yag', time: 20.155, cls: 'kick' as Kit, evidence: '808 sustain: DSP kick 0.04 blips (low -0.1); model 0.00; not shipped' }
];

const FINDINGS: string[] = [
	'## Kit plausibility per span',
	'',
	'Counts from `lab/spotcheck.md`; band rises from `lab/bands/<id>.json`. "shipped" = present in the library `<id>.analysis.json`.',
	'',
	'| track | kicks: firing on 808 glides / bass notes without a transient? | claps and snares: registered by the snare class? | hats / shakers / rides: model hat vs DSP hat (shipped) |',
	'|---|---|---|---|',
	'| The Box 0-40 s (808 rap) | No. 19 of 21 model kicks have low +14 to +35 dB; the 2 soft ones (+2.6, +2.9) sit on the same loop slot in every 4-bar repeat (masked re-triggers). DSP kick blips 24 times on 808 sustain (0.03-0.09), none shipped. | Thin trap snare (crack +14, body +6, no low) registers 0.47-0.85; bars 9/13/17 lose it (model 0.02, DSP 0.83, crack +16). | DSP 8ths ship (98); model adds 32nd rolls (5 ticks, air +8-10) of which 1 ships (invented); 4 invented 8ths (0.26) confirmed by air +7-14. |',
	'| SICKO MODE 0-45 s (rap intro) | No kick at all: the 808 line has no attack (low +0.4 to +3.9 dB at bar starts); model, DSP and cache all silent, correct. | No snare present or fired. | DSP hat fires 32 times (28 shipped, 0.06-1.0) on bright bursts (air +12 to +35) spread over all 16 slots with no pattern; model hat 0.00 everywhere: vocal sibilance, false. |',
	'| Habibi 0-30 s (disco/pop) | No. Chorus four-on-the-floor ships 0.74-1.0 with low +4 to +8 over the bass; intro drumless and shipped as such. Two quantise-invented duplicate kicks (0.16, 0.26) 46-61 ms after real ones because the beat grid runs ~60 ms early in bars 16-18. | Off-beat clap/open-hat element (crack +7-24, air +14-30) ships as snare 0.19-0.88 in 27 slots; 14.094 (crack +4) is a false one. DSP snare fires 30+ times in the drumless intro (not shipped). | DSP 120 / model 80 / shipped 129: 8ths and 16ths, plausible. |',
	'| Desire 25-60 s (trance) | No. Drop kicks ship 0.77-1.0 (first kick low +52; later +4-7 over the sidechained bass). Beat grid ~60 ms early against the kicks (kicks at slot .14). | EDM claps on 2/4 register: model 0.45-0.83 (body +9-11, crack +8-12, air +12), shipped 0.37-1.0. Build roll (16ths, all bands +8-14, decay 60 ms) invisible to both (snare <=0.03), nothing shipped in bars 18-21. | Off-beat open hats ship from DSP (air +18-29). Model hat 0.33-0.60 one 16th before beats 2/3/4 on the sidechain swell (air -2 to -4): 58 model-only false, none shipped. |',
	'| Sunset 95-130 s (house) | No. A sub-bass stab one 16th before beat 2 every bar (low +16 to +31, body +14-21, crack <=+2) gets model 0.01-0.03 and DSP 0.00. The kick 130 ms later shows only +1.5-3.6 dB low rise (stab still sounding) yet ships 0.89-1.0. | Claps on 2/4 (bars 56-63) ship 0.67-0.88 (model 0.62-0.87; body +9-20, crack +15-22). | Off-beat hats ship from DSP 0.24-1.0 (air +10 to +22). 61 model-only hats include bass notes (101.630: body +14, air -1), not shipped. |',
	'| Summertime Sadness hardstyle 20-50 s | Bars 18-23: no kick ships (model <=0.14); bars 24-30: kick ships 0.11-0.89 (median ~0.3) on every beat. DSP kick 0.0-0.43 on kicks, 0.7-1.0 on the reverse bass (not shipped). | Snare ships 0.19-1.0 on EVERY beat for 13 bars (model 0.13-0.9). The hit is a mid/high click (crack +5-12, air +5-13); low band flat in the build, +6-9 dB per beat in the drop: high-passed then full hardstyle kick labelled snare. | DSP hats ship (104, air +5-13); model hat 21 only. |',
	'| Hedex MHITR 30-60 s (DnB) | No bass false hits; 4x4 drop section low +26 to +39 per beat, ships 0.84-0.96. DSP kick peaks 40-60 ms late (not shipped). | 2-step section separates cleanly (kick with snare <=0.07, snare with kick <=0.01). Drop bars 25-32 ship kick AND snare on every beat/subdivision (model 0.75-0.85 / 0.71-0.89); the snare sample itself carries low +33, so layered vs double fire is unresolved. | Off-beat 8ths ship from DSP (air +10-11); model 107 vs DSP 157. |',
	'| Vandr 0-30 s (rock) | No. 75 model kicks, all low +7 to +14; DSP 7 bass-like (not shipped). | Backbeats register 0.88-0.94 (body +18, crack +10). DSP snare fires 116 times on guitar (not shipped). | DSP ships 154 (8ths); model 58. A few shipped DSP hats sit off the 8th grid on guitar/wash (7+0.83, 6+3.34) at 0.75-1.0. |',
	'| Spend Dat 0-30 s (trap) | No. 808s ship with low +21 to +59, including off-grid ones (2+3.73). One error type: kick class 0.41 on the beat-4 clap (low +0.3) ships a kick of 0.49 next to the snare. | Claps/snares register 0.80-0.88 (body +14-25, crack +34-52). | Model 104 / DSP 89 / shipped 78; model-only 16th ticks have air +14 (real). |',
	'| Doppler 60-90 s (techno) | No. 62 model kicks, all transient (low +7-10 over the bass, body +9-25), ship 0.5-0.9. DSP kick 121 with 50 soft (not shipped). | Correctly none on kicks (model <=0.05); DSP snare 1.0 on every kick (not shipped). | Track runs straight 16ths (crack +13-26, air +13-23 on every 16th; off-beat open hat +38). Model hears 264; DSP curve 0.07-0.09 on closed ticks (open hats set the normalisation) so the cache ships only off-beat 8ths (82): 3 of 4 hats missing. |',
	'',
	'## Per-track findings',
	'',
	'**The Box (IxJjY5T9yag) 0-40 s, 117 bpm.** Intro 4-16 s is drumless (the vocal sample is odf-only) and nothing ships there. From the drop the model kick fires only on 808 hits with a real attack; the DSP kick would have added 24 sustain blips. The half-time snare (beat 3) is thin (crack +14, body +6, no low) and ships at 0.56-1.0 in 9 of 12 bars; in the 4th bar of each loop (bars 9, 13, 17) only a kick ships although the crack band rises +16 dB like the true snares (DSP snare 0.83-1.0, model 0.02-0.26): probable missed snares, medium confidence. Hats ship as straight 8ths from the DSP; the 32nd rolls are heard by the model (0.41-0.50, air +8-10) but the cache keeps one invented tick. Shipped errors in the library analysis: 3 missed snares, thinned rolls; no false kicks.',
	'',
	'**SICKO MODE (NQbkGDoD7B0) 0-45 s, 78 bpm.** No kick or snare from model, DSP or cache anywhere; the 808 bassline (6-8 dB RMS jumps at bar starts) has no attack (low +0.4 to +3.9 dB), so the silence is right. The DSP hat fires 32 times (28 shipped, 0.06-1.0) on bright bursts (air +12 to +35 dB, crack +4 to +11) scattered over all 16 slots with no repeating pattern, and the model hat is 0.00 at every one: rap sibilance and consonants, not hats. Shipped error: ~28 false hats between 27.5 and 45 s (medium confidence, argued from grid irregularity and model silence, not by ear).',
	'',
	'**Habibi (tWEaUKCQ8Fg) 0-30 s, 147 bpm.** Intro drumless in the cache (DSP snare would have fired 30+ times, model kick 0). Chorus kicks ship 0.74-1.0 with modest low rises over the bass; the off-beat 8th element (crack +7-24, air +14-30) ships as snare 0.19-0.88 in 27 slots, one (14.094, crack +4, air +3) without a transient. Bars 16-18 have the cached beat grid ~60 ms early against the kicks, so detections land on slot .0 while the loop pattern votes for slot .25, and quantise invents duplicate kicks 46-61 ms after real ones (28.630 at 0.16, 29.840 at 0.26): shipped false kicks caused by grid phase, not by the model.',
	'',
	'**Desire (UARSiWU8eoo) 25-60 s, 138 bpm.** Breakdown ships hats 0.1-0.65 and no kicks (fine). The build\'s 16th-note noise roll (32.6-39 s, every band +8-14 dB, decay 60 ms) is invisible to both detectors (snare <=0.03); nothing ships in bars 18-21 but the first kick. Drop: kicks on every beat ship 0.77-1.0; claps on 2 and 4 ship 0.37-1.0 from the model (0.45-0.83), so EDM claps do reach the snare class. Off-beat open hats ship from the DSP. The model hat fires 0.33-0.60 one 16th before beats 2/3/4 on the sidechain swell (air -2 to -4 dB): 58 false model-only hats, none shipped. The cached grid sits ~60 ms early relative to the drop kicks (slot .14-.16).',
	'',
	'**Sunset (bEgS_KJCxTU) 95-130 s, 125 bpm.** Every bar carries a sub-bass stab one 16th before beat 2 (low +16 to +31, body +14-21, no crack); neither the model (0.01-0.03) nor the DSP kick (0.00) fires on it, so the bass-note subtraction and the model both hold. The kick on beat 2 shows only +1.5-3.6 dB low rise because the stab is still sounding, yet ships 0.89-1.0 from the model. Claps on 2/4 (bars 56-63) ship 0.67-0.88. Off-beat hats ship 0.24-1.0 from the DSP with air +10 to +22; the model hat has 61 model-only firings including bass notes. No shipped errors found.',
	'',
	'**Summertime Sadness hardstyle (AHaIdOXzzuE) 20-50 s, 167 bpm.** The kit is misread. Bars 18-23 (26-33 s): every beat ships a snare (0.19-0.97, model 0.13-0.81) and no kick (model kick <=0.14); the hit is a mid/high click (crack +5-12, air +5-13) with a flat low band. From 35 s the same click continues and the low band bumps +6-9 dB on every beat (hardstyle kick plus reverse bass); the model fires kick 0.3-0.8 and snare 0.8-0.9 on the same hit, so the cache ships snare 0.9-1.0 plus a kick of 0.11-0.89 (median ~0.3) on every beat, and bar 31 (kick roll) ships as 16th snares. Reading: a high-passed hardstyle kick in the build labelled snare, and the full kick split between the classes; the alternative (clap on every beat for 13 bars) is less likely but not excluded. The DSP kick misses the hardstyle kick (0.0-0.43) and fires 0.7-1.0 on the reverse bass instead. Shipped errors: ~24 missing kicks and ~24 false snares in the build, weak kick levels and double-fired snares in the drop.',
	'',
	'**Hedex MHITR (mbWOIqlrqFU) 30-60 s, 175 bpm.** Build bars 22-24 ship a snare on every beat with off-beat hats (model 0.87, body +14, crack +12). Drop bars 25-30 ship kick and snare on every beat (model 0.75-0.85 / 0.71-0.89; low +26 to +39, body +9-20, crack +5-12); bars 29-32 (machine-gun roll) ship kick+snare on every 8th then 16th. In the 2-step section (52-60 s) the classes separate cleanly and the snare sample itself carries low +33 dB, so the 4x4 section is plausibly a layered kick+snare hit rather than a double fire; the evidence cannot settle it. DSP kick peaks 40-60 ms after the model\'s placed time (not shipped). Hats: off-beat 8ths from the DSP.',
	'',
	'**Vandr (cOpRvLUSMiQ) 0-30 s, 171 bpm.** Clean baseline: 75 model kicks all with low +7 to +14 dB, backbeats with body +18 and crack +10 (model 0.88-0.94), no bass-like kicks. The DSP snare fires 116 times on guitar (not shipped). Hats ship 154 8ths from the DSP (the model finds 58); a few shipped DSP hats sit off the 8th grid on guitar or cymbal wash (10.072 at 7+0.83, 9.550 at 6+3.34) at 0.75-1.0.',
	'',
	'**Spend Dat (yynqCKDI7kQ) 0-30 s, 90 bpm.** 808 kicks (low +21 to +59) and claps (body +14-25, crack +34-52) ship cleanly, including off-grid 808s. One shipped error type: the kick class fires 0.41 on the beat-4 clap (10.130, low +0.3 dB) and a kick of 0.49 ships next to the snare 0.89; the slot-12 "KSH" recurs in bars 0, 3, 7, 10. Hats: 78 ship (8ths plus rolls); model-only 16th ticks with air +14 are real and unshipped.',
	'',
	'**Doppler (-5XxjPOedc0) 60-90 s, 135 bpm.** Kicks: four-on-the-floor, all 62 model kicks transient (low +7-10 over the bass, body +9-25), shipped 0.5-0.9, no bass false hits. Snares: correctly almost none (model <=0.05); the DSP snare would put 1.0 on every kick. Hats: the track runs straight 16ths (crack +13-26, air +13-23 dB on every 16th; off-beat open hat +38). The model hears all of them (264, 0.36-0.63) but the DSP curve sits at 0.07-0.09 on closed ticks because the open hats set the normalisation, so the cache ships only the off-beat 8ths (82): three of every four hats are missing from the shipped analysis.'
];

const reports = new Map<string, Report>();
const report = (id: string) => reports.get(id) ?? (reports.set(id, load(id)), reports.get(id)!);
function position(r: Report, t: number): { bar: number; beat: number } {
	const b = r.bars.find((x) => t >= x.start && t < x.end) ?? r.bars[0];
	return { bar: b.bar, beat: Math.round(((t - b.start) / r.grid.beatPeriod) * 100) / 100 };
}
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
/** DSP curves peak 40-60 ms after the placed onset (placeOnOnset moves hits to the broadband peak). */
function dspPeak(r: Report, cls: Kit, t: number): number {
	return curveMax(r, r.curves.dsp[cls], t + 0.02, 0.05);
}

function enrich(j: { id: string; time: number; cls: Kit }) {
	const r = report(j.id);
	const pos = position(r, j.time);
	const rises = bandRises(j.id, j.time);
	const cached = cachedLevel(r, j.cls, j.time);
	return {
		title: r.title,
		bar: pos.bar,
		beat: pos.beat,
		cachedLevel: r2(cached),
		modelAct: r2(modelAct(r, j.cls, j.time)),
		dspCurve: r2(dspPeak(r, j.cls, j.time)),
		bandRiseDb: { low: rises.low, body: rises.body, crack: rises.crack, air: rises.air },
		shipped: cached !== null
	};
}

const hits = JUDGED.map((j) => ({ id: j.id, time: j.time, class: j.cls, ...enrich(j), verdict: j.verdict, confidence: j.confidence, evidence: j.evidence }));
const nonHits = NON_HITS.map((n) => ({ id: n.id, time: n.time, class: n.cls, ...enrich(n), evidence: n.evidence }));
writeFileSync(join(LAB, 'judged-hits.json'), JSON.stringify(hits, null, '\t'));
writeFileSync(join(LAB, 'judged-nonhits.json'), JSON.stringify(nonHits, null, '\t'));

const fmt = (v: number | null) => (v === null ? '-' : v.toFixed(2));
const lines: string[] = [];
lines.push('# Judged kit hits, rap/EDM spot checks (experiment F)', '');
lines.push('Fields: cachedLevel = level in the library `<id>.analysis.json` onset stream within 30 ms (null = not shipped); modelAct = raw ADTOF class activation, max within 20 ms; dspCurve = detectDrums curve, max in -30..+70 ms (its low-band peak trails the placed time); band rise = onset step of the 20-200 / 150-400 / 1500-8000 / 6000-20000 Hz bands (dB, frame vs the 30-60 ms before it, best frame in -20..+30 ms), from `lab/bands/<id>.json`. Sources: `bench/reports/audio-reliability/intro/<id>.{json,md}` (bench/audibility.ts) and `lab/spotcheck.md`.', '');
const count = (v: Verdict) => hits.filter((h) => h.verdict === v).length;
lines.push(`${hits.length} judged hits: ${count('true-hit')} true, ${count('false-hit')} false, ${count('missed-hit')} missed; plus ${nonHits.length} true negatives in judged-nonhits.json.`, '');
lines.push(...FINDINGS, '', '## Judged hits', '');
lines.push('| id | title | t | bar+beat | class | verdict | conf | cached | model | dsp | rise low/body/crack/air dB | evidence |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const h of hits) {
	const b = h.bandRiseDb;
	lines.push(`| ${h.id} | ${h.title.slice(0, 18)} | ${h.time.toFixed(3)} | ${h.bar}+${h.beat.toFixed(2)} | ${h.class} | ${h.verdict} | ${h.confidence} | ${fmt(h.cachedLevel)} | ${fmt(h.modelAct)} | ${fmt(h.dspCurve)} | ${b.low}/${b.body}/${b.crack}/${b.air} | ${h.evidence} |`);
}
lines.push('', '## True negatives (loud events correctly absent from the kick stream)', '');
lines.push('| id | title | t | bar+beat | class | model | dsp | rise low/body/crack/air dB | evidence |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const n of nonHits) {
	const b = n.bandRiseDb;
	lines.push(`| ${n.id} | ${n.title.slice(0, 18)} | ${n.time.toFixed(3)} | ${n.bar}+${n.beat.toFixed(2)} | ${n.class} | ${fmt(n.modelAct)} | ${fmt(n.dspCurve)} | ${b.low}/${b.body}/${b.crack}/${b.air} | ${n.evidence} |`);
}
lines.push('', '## Verdicts by class and shipped state', '');
lines.push('| class | true (shipped) | false (shipped) | missed |');
lines.push('|---|---|---|---|');
for (const cls of ['kick', 'snare', 'hat'] as Kit[]) {
	const of = (v: Verdict) => hits.filter((h) => h.class === cls && h.verdict === v);
	const shipped = (xs: typeof hits) => xs.filter((h) => h.shipped).length;
	lines.push(`| ${cls} | ${of('true-hit').length} (${shipped(of('true-hit'))}) | ${of('false-hit').length} (${shipped(of('false-hit'))}) | ${of('missed-hit').length} |`);
}
writeFileSync(join(LAB, 'judged-hits.md'), lines.join('\n'));
console.log(lines.slice(0, 4).join('\n'));
console.log(`wrote ${join(LAB, 'judged-hits.{json,md}')} and judged-nonhits.json`);
