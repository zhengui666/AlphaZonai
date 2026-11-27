# Performance and trade review

Open the dashboard's performance view, choose paper or live and select a
snapshot by strategy, account and time. The AI review assesses whether to
change the strategy, adjust its role in the portfolio or retest a parameter.

## Daily review

In **Settings → Performance review settings**, choose whether to run daily
reviews and when to start them. The default is 08:00 Shanghai time. At the
selected time Pi Durable reviews the previous Shanghai calendar day, from local
midnight up to the next midnight. Paper and live trading each get their
own review. Each active environment uses the default model for diagnosis
and for the three adjustment judgments. A day without observable activity
only updates the schedule status. Closing the dashboard leaves the schedule
running.

Select a default in **Settings → Model settings** and set a strategy token
in **NautilusTrader settings**. Install the matching CLI on the Nautilus node
and give its publisher a private file containing that token. Register the
publisher on the existing node loop for each account and strategy.

```python
from quant.performance import publish_daily_performance

publisher = node.get_event_loop().create_task(
    publish_daily_performance(
        node, mode="paper", account_id="SIM-001", strategy_id="Trend-001",
        token_file="/etc/alphazonai/strategy.token",
    )
)
```

Use the actual Nautilus identifiers. The CLI defaults to
`http://127.0.0.1:8787`. Pass `url="https://your-service.example"` to the
publisher for a remote instance. Retain the task handle and call
`publisher.cancel()` when the host stops. The publisher captures once on
attachment and then at 00:05 Beijing time. Its snapshots cover the native
cache from the previous local midnight to capture time. It uploads via the
CLI on a worker thread and retries transient failures with the same snapshot
while the process is running. To supply actual strategy settings with each
capture, pass `parameters=lambda: {"entry_threshold": strategy.config.entry_threshold}`
when the strategy defines that parameter.

The daily review counts fills by execution time and realized P&L by position
close time, retaining the currency of each amount. It deduplicates native
records from overlapping snapshots. A position carried through midnight can
inform the risk discussion even on a day with no fills. Its current quantity
or later close P&L cannot establish its marked value at that midnight.

The dashboard shows the review date, outcome and next scheduled time.
Missing data and missing model credentials have separate statuses. Pi checks
again every 30 minutes for the current due date and retains the inputs of a
review once submitted. After a service restart, the persisted scheduler
processes missed dates for which reports and model settings are available.
Use `alphazonai performance review-list` to look up reviews and schedule status.

## On-demand review

Select a default in **Settings → Model settings**. Review requests inherit the
language and objective in **Performance review settings** unless overridden.
Choose the main report and optionally add other strategies, a paper execution
of the same strategy, or an earlier snapshot. Add the decision you are considering. For an allocation
question, include current weights and constraints when available. For a
parameter question, include the current setting or select it at export.

1. **Diagnosis.** The model inspects per-currency results, sample sizes,
   execution costs and selected native records. The first stage saves its
   observations, references and limits in Pi Durable.
2. **Decisions.** A second model call reviews those observations and the
   underlying inputs. It returns a separate keep, adjust or insufficient-data
   judgment for strategy, portfolio and parameters. Each judgment identifies
   its basis, uncertainty and next step.
3. **Inspect.** Read the original snapshots and trace positions to their
   individual fills. An adjustment is a proposal for a separate experiment.
   Use the model's stated criterion to judge whether to adopt it.

The review uses the provider, model, reasoning level and speed recorded at
submission. The provider receives a compact selection of the reports plus
the optional question. Pi persists progress so reopening the page can recover
the diagnosis and decisions. The local browser and authorized CLI can request
a review. Research, order submission and configuration changes require their
own workflows.

## Capture an existing session

Use `quant/performance.py` from this release on the host that owns the
NautilusTrader 1.231.0 node. With the repository on that host's Python path,
call the following in the host process while its cache is available, for
example after stopping the node and before disposal. Supply the account and
strategy IDs reported by Nautilus. Set `mode` to `paper` for a simulated
execution account or `live` for its funded counterpart.

```python
import json
from pathlib import Path
from quant.performance import performance_report

report = performance_report(
    node, mode="paper", account_id="SIM-001", strategy_id="Trend-001",
)
Path(f"{report['id']}.json").write_text(json.dumps(report), encoding="utf-8")
```

To include current parameter values, pass the optional `parameters` dictionary
with the specific settings under review, for example
`parameters={"entry_threshold": strategy.config.entry_threshold}` for a
strategy that defines that field. The host selects the values to share.

Import the resulting file with the same strategy token. Use `--url` for a
remote instance. Each report can be up to 32 MiB. Exchange credentials stay
on the trading host.

```sh
alphazonai performance import --report-file report.json --token-file /etc/alphazonai/strategy.token
```

A snapshot covers the history visible in the native cache at capture. A cache
restored across restarts can include earlier trades. A pruned cache can omit
them. The session ID identifies the exporting node instance. Later snapshots
of the same instance can overlap. Earlier and later snapshots can be reviewed
side by side. Adding their cumulative P&L or trade counts would double-count
the shared history.

## Reading a snapshot

| Measure | Interpretation |
| --- | --- |
| Closed-position P&L | Sum of native realized P&L on fully closed positions, grouped by settlement currency. Partial exits on positions that remain open are visible in position detail. |
| Maximum drawdown amount | Largest drop from a preceding peak in the cumulative closed-position curve, starting at zero. Open-position mark-to-market swings are outside this measure. |
| Win rate | Profitable closed positions divided by closed positions with a recorded outcome, including breakevens. Read alongside the sample count. |
| Profit factor | Sum of positive closed outcomes divided by the absolute sum of negative ones. Shown only when there is a loss to divide by. |
| Fill commissions | Native fill fees grouped by the currency actually charged. Fees in the settlement currency are already reflected in native realized P&L. |
| Account balances | Latest total, free and locked amounts for the whole selected account, which can be shared by several strategies. |

The curve steps when positions close. Individual fills retain the native
trade and order IDs, including separate fills of one order. Monetary amounts
retain decimal precision in the report. Comparing paper and live outcomes
requires matching the strategy, instrument universe, capital and observation
period. Portfolio percentage returns and Sharpe require cash flows and a
marked equity series.

## Storage

The exporter reads Nautilus's own account, order and position records. Pi
Durable stores each snapshot and its list entry together in the existing
SQLite store. `POST /api/performance` imports a report. Repeating the same
file returns the existing ID. `GET /api/performance` lists summaries and
`GET /api/performance/:id` reads a snapshot. These reads share the existing
dashboard's visibility. Anyone with dashboard access can read the imported
account balances and trade history.

Upstream references cover the [native report fields](https://github.com/nautechsystems/nautilus_trader/blob/v1.231.0/nautilus_trader/analysis/reporter.py)
and [Nautilus position accounting](https://github.com/nautechsystems/nautilus_trader/blob/v1.231.0/nautilus_trader/model/position.pyx).
