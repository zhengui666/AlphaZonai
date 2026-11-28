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
the same task tree. NautilusTrader owns ingestion, catalog layout and query
validation. Each research run passes its data class and selectors to the
configured `ParquetDataCatalog` and records the query in the run report.
The default query requests `nautilus_trader.model.data:Bar` with no bar-type
or instrument restriction. For other classes, the scope of `identifiers`
follows NautilusTrader's query API. The exclusive end of the requested
research interval maps to the preceding nanosecond in the catalog's inclusive
time range. For a custom data class, use the fully qualified name registered
in the configured Nautilus Python runtime. Registration and decoding belong
to that runtime.

The evaluator snapshots returned features for the isolated factor worker,
using `ts_init` as the time each observation became available. The report
includes the observed columns, counts of rows and distinct timestamps, and
the number of rows with a forward-return label. Labels use the bar close,
trade price, quote midpoint, or a numeric field selected by `targetField`.
For a custom series, `instrumentField` selects the source field that identifies
the instrument. Native fields that collide with the evaluator index names
`ts` and `instrument` keep their values under a `native.` prefix.
The horizon is elapsed time in minutes. A label uses a later observation from
the same series at or before the horizon and requires that the series reaches
that horizon. The snapshot keeps repeated observations. At a given timestamp,
scoring averages the paired factor and forward-return values within each
instrument so each instrument contributes once to the cross-section. Scores
require enough instruments and shared timestamps.

The worker keeps the feature and label files while the run is active or
paused so retries use the same observations. It removes both files when the
run ends. Pi retains the research report, including the native query, coverage
and factor evidence. NautilusTrader retains the source data. The report
preserves Nautilus query errors and distinguishes an empty result from a
successful read with no usable return labels.

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
| POST `/api/runs` | `id` (UUID request key), `preset` (minute or paper), `model`, `thinking`, `start`, exclusive `end`, `horizon` in minutes and `seed`. Optional `data` carries the catalog query, e.g. `{"data_cls":"nautilus_trader.model.data:TradeTick","identifiers":["ETHUSDT.BINANCE"]}`. Optional `targetField` selects the forward-return field. The minute preset also accepts `parallel`, `generations` and `plateauWindow`. |
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
