# CogAlpha method mapping

Reference: ACL 2026 final paper, §§3–4 and Appendices A–C.
The implementation is independent; paper figures and upstream prompts are not vendored.

| Method | Implementation | Engineering choices |
|---|---|---|
| Seven layers / 21 roles | `src/method.ts`, generation planning | Seeded 13-role selection per run and round-robin role allocation. Roles are discovery lenses, not a strategy allowlist. |
| Five paraphrasing styles | Candidate guidance stage | Select a style with a seeded PRNG; get an actual rewritten instruction before generating code. |
| Four reviewer / repair roles | Candidate phases | Two retries by default; revisions re-enter both reviewers. Candidate programs never get trading tools. |
| Numerical and leakage checks | `quant/bridge.py` and `quant/factor.py` | Static negative-lag/backfill check plus prefix and future-perturbation checks at three time cutoffs. Numerical overflow, divide-by-zero and invalid operations fail; benign floating-point underflow to zero is not rejected in isolation. |
| IC, RankIC, ICIR, RankICIR, MI | `quant/score.py` | Midranks; sample SD for IRs. MI uses timestamp-wise equal-frequency rank bins with bias correction and natural logarithms; require sufficient cross-sectional support. The authors do not specify this estimator. |
| Qualified and elite pools | `select` in `src/method.ts` | Linear-interpolated per-metric quantiles over valid scored candidates; strict percentile and inclusive floors; ties ordered by metric vector then candidate ID. |
| Adaptive generation | Run settlement | Two seeded valid examples and up to two failures. Failures without a meaningful vector precede below-threshold scored examples. Notes and original evidence are retained. |
| Evolution | Candidate planning and checks | Mutation, crossover, crossover-then-mutation, with independent checks; sample second parent without replacement. A one-parent pool runs mutations; an empty pool starts a new seed batch rather than silently weakening cutoffs. |
| Periodic injection and elite retention | Run settlement | Add eight fresh candidates on eligible paper generations; check against peers and carry two prior elites. Eight is an engineering choice. |
| Stop conditions | Run settlement | Fixed generation limit, or optional plateau using the mean first fitness metric of elite candidates; default off. |
| Paper sampling | Native Pi provider hook | Output cap 4,096; generation and evolution temperatures from 0.7 to 1.2; reviews/repairs at 0.8. Providers or models that do not accept temperature use provider defaults. |
| Stock experiments | Outside runtime | No market data recreation, model training, benchmark portfolio, or claimed performance reproduction. |

The minute preset uses separate starting floors. They are hypotheses to validate,
not estimated optimal thresholds or evidence of out-of-sample performance.
