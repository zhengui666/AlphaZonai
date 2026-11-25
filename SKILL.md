---
name: alphazonai
description: Start and inspect AlphaZonai candidate-search runs or export selected factors from a running instance.
---
Use the deployment's configured base URL. Match the language selected in the
Web UI, or default to English if no locale was supplied by the user or client.
Read [the HTTP contract](docs/design.md#http) for submission, run controls, and
export. List available models before starting. Preserve the request ID on
retries, and treat a run as complete only once its terminal state is visible.
Report score and data coverage separately. Exported factors are research
artifacts, not evidence of a successful backtest or live trading.
