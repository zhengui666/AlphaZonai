# Agent control and reporting design

AlphaZonai separates the human report surface from the external-agent control
surface. The Web dashboard reads research, coverage, candidate evidence, strategy
validation, deployment receipts and execution reports. A local browser can
configure its model and request an AI review of imported reports. An agent
uses the CLI to initiate or manage work and to obtain
machine-readable results. Neither surface owns an execution engine: Pi Durable
owns the task lifecycle, and NautilusTrader owns Catalog reads and backtests.

## What we borrowed from Lark

The [official Lark CLI](https://github.com/larksuite/cli) combines readable
domain commands with command schemas and a consistent JSON/error contract.
Its [domain skills](https://github.com/larksuite/cli/tree/main/skills) teach a
small number of end-to-end workflows and reference commands instead of
duplicating the API. [Agent Skills](https://agentskills.io/specification)
defines the frontmatter and progressive disclosure format for that entry point.

AlphaZonai adopts these design decisions:

- Prefer task-oriented commands to repeated parsing of Web responses or prompts.
- Publish read-only discovery and a machine-readable command contract. Return
  command results on stdout and actionable errors on stderr, with meaningful
  exit status. Keep human presentation separate from data.
- Support no-network dry-run previews for state changes. Allocate stable write
  IDs before submitting, keep those IDs on retry, and never report a timed-out
  or merely accepted request as a completed research run.
- Keep the external skill short and procedural. The machine-readable CLI and
  reference docs own exact flags, shapes, errors, and recovery rules.
- Do not expose uncontrolled raw HTTP or an arbitrary shell in the CLI. Expose
  the domain operations with stable semantics. There is no live-start command.

## Research input and evidence

A run accepts optional free-text `direction` in addition to its existing model,
dates, and prediction horizon. It is bounded at 4,000 characters and copied
both into durable task input and the run report. A blank direction keeps the
automatic discovery workflow. The direction and the actual scoring horizon
come through each model phase and into strategy generation, including after
restart. The later strategy brief is separate from the original research
direction. No prompt can change the underlying return-label calculation or the
data available to the candidate. A prediction horizon is not a holding period.

The current minute-bar input does not include historical market capitalization.
A possible trailing dollar-volume proxy for liquidity must be described as a
proxy with known volume units, not presented as historical market cap. A
requested constraint unsupported by the data should be acknowledged, not
fabricated.

Run admission takes a client UUID. The same new-version run ID and normalized
request return the existing receipt even if model settings have since changed.
Changing an admitted request under the same ID is a conflict. Legacy run IDs
remain reserved and are never restarted on a repeated submission. If a result
is uncertain, read that exact ID before deciding to submit it again.

## Deployment and authorization

Keep the server bound to localhost or put it behind a trusted access layer. A
non-loopback deployment must configure `ALPHA_AGENT_TOKEN` for research writes
and use HTTPS. The local, loopback-only setup can operate without that token.
Strategy writes retain their separately configured `ALPHA_STRATEGY_TOKEN`.
These settings are independent of model credentials. The service rejects
browser-origin run and strategy writes rather than relying only on hidden
buttons. Do not directly expose the reporting API to unauthenticated visitors.

A successful push installs the exact validated strategy package as inactive.
It does not attach an exchange account, start Nautilus live trading, or
activate the package. The dashboard should show the actual receipt state and
never manufacture price or equity history from aggregate metrics.
