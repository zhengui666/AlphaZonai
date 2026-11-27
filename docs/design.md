# Design

The host embeds Pi Durable with its supported Node SQLite store. A typed Pi
document carries run summaries and outcomes; the work itself is represented as
a Pi task tree. There is no separate task DB, queue, agent loop, or model gateway.
Each agent role uses its own Pi conversation, with a stored request key and
native submission deduplication. An interrupted provider request can be retried.

A run owns a generation, which owns candidate tasks. Candidates dispatch in
bounded batches and settle under allSettled. The run commits selection once per
generation. Pause is a durable wait at the next generation boundary. Stop
aborts the task tree. After reconnect the browser gets the latest document
snapshot; there is no browser-owned checkpoint.

The domain interface supplies the artifact contract, data preparation, metric
keys and scoring. Its test implementation uses a non-financial candidate and
the same task tree. The production application ships the Nautilus adapter. It
reads published minute bars through `ParquetDataCatalog`, using `ts_init` as
availability, and produces an immutable research query snapshot. Requested
dates are UTC with an exclusive end. All observed eligible instruments are
included at each timestamp; a missing bar is never synthesized. A label
requires a contiguous sequence for that instrument through the configured
horizon. It is a predictive label, not a fill price. The run reads the selected
development interval only; it performs no holdout evaluation.

The Python process that loads the Catalog and labels never imports model
output. Only the candidate worker executes generated code, using Bubblewrap
with a clean environment, dedicated process/network namespaces, a read-only
feature file and a temporary directory. It does not receive labels, the live
catalog, or keys. The pinned runtime is NautilusTrader 1.231.0. Data and
execution belong to Nautilus throughout; the candidate export is a research
handoff, not a Nautilus strategy ready to trade without integration.

## HTTP

| Method and path | Payload / result |
|---|---|
| GET `/api/models` | Pi provider catalog and supported reasoning levels |
| GET `/api/settings` | Current settings and credential connection status for the local dashboard and CLI |
| POST `/api/settings/:section` | Apply a model action or update fields in the `nautilus`, `review` or `data` section |
| POST `/api/runs` | `id` (UUID request key), `preset` (minute or paper), `model`, `thinking`, `start`, `end`, `horizon`, `seed`; minute preset also accepts `parallel`, `generations`, `plateauWindow` |
| GET `/api/runs` | Run summaries |
| GET `/api/runs/:id` | Current snapshot with already settled generations |
| GET `/api/runs/:id/events` | Snapshot stream; reconnect reads latest state |
| POST `/api/runs/:id/actions` | `{"action":"pause"}`, resume, or stop |
| GET `/api/runs/:id/export` | Versioned JSON with elite candidates, scores, and lineage IDs |

## Developer checks

Node 24 and Python 3.12 are required. Install npm dependencies and
`quant/requirements.txt`, then run `npm test`. Tests exercise Pi SQLite
persistence, selection and time alignment with test observations, never model
billing or market returns. Use the actual browser and Linux sandbox for release
acceptance. A protocol test is not a live model validation.
