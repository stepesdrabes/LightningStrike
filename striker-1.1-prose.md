## My recommendation: make Striker 1.1 an event-quality release—not an architecture replacement

**For 1.1, I would keep your separation → multi-view ADTOF → LightGBM architecture and concentrate on three outcomes: more accurate timestamps, better recovery of weak and overlapping hits, and more reliable decisions when the different views disagree.**

I would not make a larger neural network, another separator, or real-time operation the central objective yet.

Your report describes a system with six transcription views, additional audio-derived candidates, and an 85-feature learned decision layer. That gives you several relatively contained places to improve performance before replacing the backbone. 

The research uncovered two particularly actionable details:

**First, the published STAR Drums generation procedure clips MIDI velocities to a minimum of 40.** Your report says that most Groove MIDI misses occur below velocity 40. That is a concrete training-coverage hypothesis to investigate—not proof of the cause, but much more specific than “get more data.” ([AudioLabs][1]) 

**Second, ADTOF’s reference peak picker uses a 100 Hz activation rate and a 20 ms peak-combination setting.** Together with your reported deterioration at a 20 ms evaluation tolerance, that makes the timing and candidate-generation implementation worth auditing before training anything larger. ([GitHub][2]) 

I have reviewed the report, relevant papers, and reference implementations. I have not inspected your actual training code, feature definitions, checkpoints, or per-event predictions. The recommendations below are therefore **prioritized experiments with decision criteria**, not claims that I have diagnosed a particular bug or can predict the next benchmark score.

---

## 1. First, establish where the remaining errors actually enter the pipeline

**This is the first task I would implement, before another training run.**

For every annotated hit that Striker misses, distinguish the following cases:

| Error category                      | Diagnostic question                                                                     | What it tells you to improve                         |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Missing candidate                   | Did any view propose the correct instrument near the annotated time?                    | Candidate generation                                 |
| Rejected or misclassified candidate | Was an appropriate candidate available but discarded or assigned incorrectly?           | Features, training labels, classifier, or thresholds |
| Timing error                        | Was the correct hit emitted, but outside the evaluation window?                         | Timestamp conversion or onset refinement             |
| Duplicate/conflicting events        | Did several proposals become extra outputs, or did merging remove a genuine second hit? | Event grouping and decoding                          |

These categories need explicit matching rules because they can overlap. I would save enough information to inspect ambiguous cases rather than force every error into a misleading single label.

### Measure the candidate ceiling

Compute **candidate recall before Striker filtering**, separately by instrument and at 20 ms and 50 ms. Use one-to-one matching: two nearby annotations must not both receive credit from one candidate.

For a selector that cannot change candidate timestamps or classes, candidate recall imposes a simple upper bound. If candidate recall is \(R_c\), even a perfect filter with no false positives can achieve at most:

$$
F_{1,\mathrm{oracle}}=\frac{2R_c}{1+R_c}
$$

For example, \(R_c=0.90\) implies an ideal maximum F1 of approximately 0.947 under those assumptions. Once you allow timestamp correction or reclassification, recompute the ceiling for that expanded system.

The practical interpretation is important:

**A classifier cannot learn to retain an event that its candidate generator never supplies.**

Conversely, if candidate recall is already excellent but final recall is poor, adding another expensive audio model may be unnecessary.

### Save an event-level diagnostic log

For each candidate, I would retain its source view, proposed instrument, original timestamp, activation score, final classifier score, acceptance decision, and any timing adjustment. For evaluation, add matched annotation IDs and errors.

Then calculate the **unique contribution of each view**: which true events become available only because that view exists?

This also creates the foundation for later speed optimization. A view that produces many candidates but almost no additional recoverable events deserves scrutiny.

One caution: candidate recall can be inflated by proposing peaks everywhere. Always report candidate density and downstream false positives alongside it.

**Deliverable:** an error breakdown that tells you whether the next unit of effort belongs in candidate generation, classification, timing, or duplicate handling.

---

## 2. Make timing the first focused improvement—but audit it before learning corrections

Your IDMT result drops from **0.971 at 50 ms to 0.917 at 20 ms**, and the report identifies hi-hats as the largest timing problem. That is a 0.054 difference in F1, not evidence that precisely 5.4% of hits can be repaired by moving them. Still, it is a strong reason to investigate timing.  

### Audit the complete time coordinate system

The reference ADTOF preprocessing uses a 2,048-sample window and a 441-sample hop at 44.1 kHz, giving 100 frames per second. Madmom exposes frame-origin conventions, including centered frames. ([DIVA Portal][3])

A centered-versus-left-edge interpretation error for that window would be approximately:

$$
\frac{2048/2}{44100}\approx 23.2\text{ ms}
$$

**I am not saying you have this error.** I am saying that a convention mismatch of this size could pass a 50 ms test while failing a 20 ms test, so it is worth ruling out.

Check audio resampling, frame origins, padding, chunk boundaries, crop offsets, separator output alignment, and conversion from activation indices to seconds. Also check parity between your deployed implementation and the reference path.

A particularly easy naming trap: in ADTOF’s peak-picking code, the default `sampleRate=100` refers to activation frames per second—not the waveform’s audio sample rate. Its `labelOffset` is converted using that frame rate. ([GitHub][2])

I would test this with precisely timestamped one-shots, repeated events at different positions within a processing chunk, and shifted copies of the same excerpt.

**Do not assume that changing the 10 ms frame grid will solve the problem.** Nearest-grid rounding on a 10 ms grid contributes at most 5 ms by itself; larger errors require another explanation.

### Add a small, audio-grounded timing refiner

Once the coordinate system is correct, compare three approaches:

**A fixed correction per instrument/source.** Estimate robust offsets using development data only. This is the simplest baseline.

**A local transient-based correction.** Around a candidate, examine short-time changes in appropriate frequency bands in the mixture and separated sources.

**A learned residual correction.** Train a small regressor to predict the offset between a candidate and the corresponding annotated onset. A LightGBM regression model is a natural first experiment because it fits your existing stack; its documented objectives include absolute-error and Huber regression. ([LightGBM][4])

For the learned version, I would use local attack-shape features, relative timing between views, and evidence of nearby competing attacks. I would train it on accurately aligned examples and restrict its adjustment range using development results.

A correct instrument detected 30 ms late should not automatically become an “instrument absent” training example. **Event existence and precise timestamp are related but different targets.**

### Refine attacks, not musical expectations

I would not snap detections to a beat grid for the main transcription output. The goal is to preserve what was played, not make it more metronomic.

Also avoid independently moving every nearby candidate to the strongest local peak. That can collapse a genuine double hit into one event.

The 2026 paper *Snapping Matters* finds advantages in resolving competing onset assignments jointly rather than through independent greedy choices. Its experiments concern pitched, instrument-agnostic transcription—not drum detection—so applying that idea to Striker is an engineering hypothesis, not a demonstrated drum result. ([AudioLabs][5])

For Striker, any competition rule should operate **within an instrument**. A simultaneous snare and hi-hat must remain legal.

**Keep the timing refiner only if it improves tighter-window accuracy without unacceptable damage at 50 ms or to flams and rolls.**

---

## 3. Repair training coverage deliberately: soft hits, overlap, and accompaniment

This is where I would put most of the new annotation and data-generation effort.

### Investigate the velocity-40 connection

STAR Drums’ published rendering procedure imposes a minimum MIDI velocity of 40. Your report uses STAR for hi-hat and cymbal training, while identifying sub-40 Groove notes as a major source of misses. That makes the connection especially relevant to those heads—not automatically to snare training. ([AudioLabs][1])  

I would first inspect the **actual data reaching training**, after all filtering and candidate generation. A dataset may contain soft notes that never become positive candidate examples.

Measure performance against both annotated MIDI velocity, where available, and an acoustic measure of local prominence. MIDI velocity is not a universal loudness scale; the STAR paper itself explicitly discusses that limitation. ([AudioLabs][1])

Then add deliberately difficult training examples: genuinely soft recorded hits and independently sourced MIDI performances rendered at several dynamic levels.

Merely turning down an entire mixture is not equivalent. It leaves the relative balance between a quiet drum and its accompaniment unchanged.

For synthetic examples, change the velocity or level of individual hits, vary other instruments independently, and run the resulting audio through the same inference pipeline used in deployment.

### Train on controlled overlap—not only isolated samples

Weyers and colleagues’ 2025 controlled study identifies accompaniment interference as a major limitation in full mixtures and overlapping drum hits as a central limitation in drum-only transcription under its controlled conditions. These findings identify difficult conditions; they do not establish that a particular augmentation will add a guaranteed number of F1 points to Striker. ([AudioLabs][6])

My recommended experiment is to create matched examples containing:

* A hi-hat alone, the same hi-hat with a snare, and that combination underneath a cymbal decay.
* A snare alone, so the model also learns not to invent the hi-hat.
* Quiet and strong versions of the same pattern across different kits and accompaniment levels.

The purpose is to separate **acoustic evidence** from learned co-occurrence habits.

Preserve a broad training distribution rather than replacing normal material with an oversampled collection of pathological examples. Decide the mixture on development data.

### Make accompaniment level an explicit robustness test

Your report gives five-class ENST scores of 0.829 under the stated two-thirds-drums mixture and 0.789 at equal drums/backing gain. These configurations should not be casually pooled into one number, but their difference gives you a concrete robustness axis to study.  

I would construct a small, predefined gain ladder on training/development stems and measure performance as accompaniment becomes more prominent.

This would help answer whether Striker fails because separation loses weak attacks, ADTOF stops proposing them, or the final classifier rejects them. Those require different fixes.

### Do not select all new positives through ADTOF agreement

Your A2MD training subset is described as being used where ADTOF agrees. That is a reasonable quality-control mechanism, but it creates a plausible selection bias: difficult events that ADTOF misses may be systematically underrepresented. This is an inference from your selection rule, not a measured property of your training set. 

For 1.1, I would manually audit some **ADTOF-disagreement passages**, alongside randomly selected passages. Annotate complete short excerpts rather than only isolated model mistakes, so apparent false positives can be evaluated against complete labels.

That gives your decision layer a chance to learn corrections to its upstream model instead of only learning when to trust it.

---

## 4. Treat label policy and dataset ancestry as engineering requirements

### Separate “not annotated” from “not present”

Your report already documents conflicts involving claps, side sticks, and residual claps in STAR accompaniment. Those conflicts caused training behavior that was undesirable for the lighting application. 

I would formalize this with a **dataset-by-class supervision policy**: which classes and articulations have reliable positives, reliable negatives, or unknown coverage?

For the independent LightGBM heads, uncertain examples can be excluded from that class’s training rather than silently treated as negatives.

This does not require adding a large new instrument vocabulary in 1.1. It requires distinguishing three things:

**What sound is present; how a benchmark defines its classes; and how the application maps sounds to lights.**

Do not alter public benchmark labels to suit the product. Keep benchmark mapping fixed and keep application behavior separate.

### Be careful with E-GMD and StemGMD

There is an important trap in the otherwise sensible recommendation to obtain more drum data.

Google’s E-GMD re-records Groove MIDI performances with additional kits and preserves the original split structure. StemGMD is also derived from Groove MIDI performances. They are not independent collections of newly played rhythms. ([Magenta][7])

Using their official training splits can support a legitimate within-family experiment. But adding them and continuing to imply that the model has never trained on the Groove data family would change the meaning of your claim.

For your strict cross-dataset evaluation, I would group **all derivatives of an original performance together** and exclude the relevant family. A separate production model can use a broader authorized training set, with its provenance stated accurately.

The same logic applies to MDB recordings versus MDBDrums++ annotations and to alternate mixes or renders of the same song. Your report explicitly identifies MDBDrums++ as re-annotated MDB recordings. 

---

## 5. Improve event fusion while retaining LightGBM

I would not replace the final classifier until the diagnostic evidence shows its representation is inadequate.

Your existing 85 features may already include some of the following. **I would audit them, not assume they are missing.**

### Favor disagreement and local contrast over simple vote counts

The six views reuse ADTOF on transformations of the same recording. Therefore, six agreeing outputs should not be interpreted as six independent pieces of evidence. 

My first feature experiments would cover three areas.

**Temporal agreement:** differences between proposed times across views, activation peak width, rise and decay shape, and whether there are multiple nearby peaks.

**Local acoustic contrast:** transient strength relative to the preceding background, evidence in relevant frequency bands, and consistency between the mixture, drum stem, and instrument stem.

**Competing explanations:** whether a supposed hi-hat coincides with snare leakage, whether a cymbal candidate has a fresh attack or only continuing decay, and whether two nearby proposals represent one event or two.

These are proposed features to validate, not claims that any individual feature will improve F1.

### Audit merging before lowering thresholds

ADTOF’s reference peak picker includes `combine=0.02`. Your wrapper may add other merging rules. Inspect both. ([GitHub][2])

A useful principle is:

> **The evaluation tolerance is not an appropriate automatic duplicate-removal radius.**

A blanket 50 ms merge could remove a genuine close pair even though 50 ms is a legitimate matching tolerance in the benchmark.

I would compare your existing grouping with a class-specific, attack-aware policy. It should combine duplicate views of the same hit while preserving evidence of two attacks. Avoid unrestricted clustering where a chain of nearby candidates gradually joins events that are not actually close.

### Separate proposal thresholds from acceptance thresholds

Where the diagnostic run identifies missing candidates, lower proposal thresholds or retain additional local maxima from **cached activation curves**, then retrain the selector on the expanded candidate distribution.

Where candidates are already present, changing proposal thresholds only increases clutter.

The target should be **additional true events at an acceptable false-positive cost**, not simply a larger number of proposals or outputs.

### Calibrate confidence only for the right reason

LightGBM’s documentation warns that `is_unbalance` and `scale_pos_weight` can produce poor individual probability estimates. That matters if you use such weighting and then interpret the output as a calibrated confidence. ([LightGBM][4])

I would evaluate per-class calibration using predictions from held-out recording groups. Calibration data must be separate from the data used to fit the corresponding classifier. ([Scikit-Learn][8])

But calibration is not a substitute for better discrimination: a strictly monotonic transformation preserves the ranking of candidates. Its main role here is making thresholds and confidence outputs more interpretable.

For the lighting engine, keep **detection confidence** separate from **intensity or salience**. A quiet real note can be confidently detected and still produce a subtle lighting response.

---

## 6. Run ablations that establish what your own layer contributes

For 1.1, I would compare four successive configurations:

**Single-view ADTOF; multi-view candidates with simple fusion; existing Striker 1.0; and Striker with each proposed change added separately.**

The multi-view/simple-fusion baseline is important. Comparing only against single-view ADTOF cannot distinguish gains from source separation, additional views, and your learned decision layer.

Related work by Riley and Dixon already combines ADTOF with drum source separation, making this a relevant architectural comparison rather than a purely hypothetical baseline. ([arXiv][9])

When testing fewer views, **retrain the selector for that input configuration**. Removing features only at inference would test robustness to missing inputs, not the best achievable smaller system.

For computation, profile the individual stages before choosing an optimization. Your report’s 31-second GPU example measures a pipeline with two separations and six transcription passes; it does not establish which part dominates on every machine. 

I would accept straightforward caching, batching, or removal of demonstrably redundant work in 1.1. I would not make an unmeasured “2× faster” objective compete with fixing event quality.

---

## 7. Use a staged experiment plan and explicit release criteria

Here is the order I would actually follow.

| Experiment                          | Change                                                          | Main question                                          | Decision                                                          |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| **E0 — Diagnostic baseline**        | Freeze 1.0; log candidates, decisions, timings, and matches     | Where are recoverable errors?                          | Required before further model selection                           |
| **E1 — Timing correctness**         | Audit coordinate conversion and simple offsets                  | Is part of the tight-window loss systematic?           | Correct verified implementation errors                            |
| **E2 — Timing refinement**          | Add local acoustic or learned residual correction               | Can correct hits be positioned more precisely?         | Keep only with controlled timing gains and acceptable regressions |
| **E3 — Candidate recovery**         | Adjust proposal generation where recall is inadequate           | Can missing real events become available?              | Require downstream benefit, not merely higher candidate recall    |
| **E4 — Targeted supervision**       | Add soft-hit, overlap, accompaniment, and disagreement examples | Does performance improve on difficult unseen passages? | Evaluate against untouched recording groups                       |
| **E5 — Fusion improvements**        | Add selected feature groups and revise event merging            | Does final selection improve beyond the data changes?  | Keep independently useful changes                                 |
| **E6 — Combined release candidate** | Combine successful changes                                      | Do the gains survive together?                         | Run the frozen release evaluation                                 |

### Separate development from the release test

Public benchmarks remain valuable, but repeatedly choosing changes based on the same test results can overfit model selection without directly training on those recordings. This is a documented evaluation problem. ([Journal of Machine Learning Research][10])

I would maintain grouped development splits and a new, untouched real-music release test. Freeze **all** learned or selected components before evaluating it: classifier, timing refiner, calibration, thresholds, and merging parameters.

Your existing cross-dataset protocol should continue, but remember that the seven headline configurations include repeated datasets in different forms. They are not seven independent collections of performances. 

### Define success before seeing the results

My proposed release criteria would be:

**Timing:** a clear improvement in 20 ms onset F1 on a predefined core evaluation, with 50 ms results retained as a regression guard. Report per-instrument results.

**Difficult events:** improved weak-hit and overlap recall at an operating point selected on development data. On the test set, report the actual precision and false positives per minute rather than retuning thresholds to force a favorable comparison.

**Regression control:** as an initial engineering budget, consider allowing no more than 0.005 loss in the predefined average 50 ms F1, with separate limits for important datasets and classes. That is a proposed tolerance—not a predicted outcome or universal standard.

**Timing distributions:** show signed error, median absolute error, and a high percentile on a fixed, consistently matched subset, while still reporting unmatched events. Otherwise, dropping difficult hits can make timing statistics look artificially better.

**Uncertainty:** use paired resampling by original recording or performance group when comparing versions. Do not treat every onset or alternate rendering as an independent experiment.

Also write scorer unit tests. ADTOF’s reference evaluator distinguishes pooled counts from mean scores and has explicit conventions for empty prediction/annotation cases. These details should be pinned and documented rather than silently changed between releases. ([GitHub][11])

---

## 8. What I would deliberately leave out of 1.1

**A wholesale move to diffusion or a large music foundation model.** Recent work such as *Noise-to-Notes* makes these directions relevant, including foundation-model features for robustness. It does not establish that they are the most efficient next improvement for your existing system. ([arXiv][12])

**Replacing the separator because its stems sound cleaner.** The August 2026 *Separate-and-Detect* preprint is relevant because it studies separation with transcription-oriented supervision and shows differing trade-offs between acoustic reconstruction and onset detection. For Striker, evaluate a separator by downstream event performance—not listening quality alone. ([arXiv][13])

**Full-kit expansion, hard beat-grid snapping, or a real-time promise.** Those would change the release’s scope. Keep the existing classes measurable, but prioritize the instruments and failure cases central to your product.

A small local neural verifier could be a stretch experiment **only if** candidate coverage is high and the improved features and supervision still leave substantial classification errors. That would be a focused response to evidence, not an architecture change for its own sake.

Finally, keep commercial permissions as a release prerequisite. The ADTOF repository states a CC BY-NC-SA 4.0 license; check the permissions applicable to your exact code, weights, and intended use rather than assuming that your proprietary final layer resolves upstream restrictions. ([GitHub][14])

## The three changes I would bet the development effort on

**First: prove that timestamps and candidate merging are correct, then add a conservative onset refiner.**

**Second: improve supervision precisely where it is weak—soft hits, overlaps, difficult accompaniment, and events rejected by ADTOF-based filtering.**

**Third: improve event-level fusion so the model distinguishes genuine acoustic support from correlated agreement across views.**

That is the Striker 1.1 I would build: **not merely a higher average score, but a version with demonstrably better timing and more complete detections, supported by an error analysis that explains why it improved.**

[1]: https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2025_WeberUML_DrumSTAR_TISMIR_ePrint.pdf "https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2025_WeberUML_DrumSTAR_TISMIR_ePrint.pdf"
[2]: https://raw.githubusercontent.com/MZehren/ADTOF/master/adtof/model/peakPicking.py "https://raw.githubusercontent.com/MZehren/ADTOF/master/adtof/model/peakPicking.py"
[3]: https://www.diva-portal.org/smash/get/diva2%3A1811103/FULLTEXT01.pdf "https://www.diva-portal.org/smash/get/diva2%3A1811103/FULLTEXT01.pdf"
[4]: https://lightgbm.readthedocs.io/en/latest/Parameters.html "https://lightgbm.readthedocs.io/en/latest/Parameters.html"
[5]: https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2026_SahaBMM_SnappingMatters_ICMC.pdf "https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2026_SahaBMM_SnappingMatters_ICMC.pdf"
[6]: https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2025_WeyersUML_LimitationsADT_ISMIR_ePrint.pdf "https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2025_WeyersUML_LimitationsADT_ISMIR_ePrint.pdf"
[7]: https://magenta.withgoogle.com/datasets/e-gmd "https://magenta.withgoogle.com/datasets/e-gmd"
[8]: https://scikit-learn.org/stable/modules/calibration.html "https://scikit-learn.org/stable/modules/calibration.html"
[9]: https://arxiv.org/pdf/2509.24853 "https://arxiv.org/pdf/2509.24853"
[10]: https://www.jmlr.org/papers/v11/cawley10a.html "https://www.jmlr.org/papers/v11/cawley10a.html"
[11]: https://raw.githubusercontent.com/MZehren/ADTOF/master/adtof/model/eval.py "https://raw.githubusercontent.com/MZehren/ADTOF/master/adtof/model/eval.py"
[12]: https://arxiv.org/html/2509.21739 "https://arxiv.org/html/2509.21739"
[13]: https://arxiv.org/html/2608.01093v1 "https://arxiv.org/html/2608.01093v1"
[14]: https://github.com/mzehren/adtof "https://github.com/mzehren/adtof"
