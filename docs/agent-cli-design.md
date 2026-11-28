# Agent control and reporting design

AlphaZonai separates the human report surface from the external-agent control
surface. The Web dashboard reads research, coverage, candidate evidence, strategy
validation, deployment receipts and execution reports. The dashboard
and CLI share settings for models, NautilusTrader, performance reviews and
data. The local dashboard and authorized CLI can request an AI review of
imported reports. An agent uses the CLI to manage work and obtain
machine-readable results. Pi Durable
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

The native catalog query determines which observations and fields reach the
factor. The run report records the query and available feature columns.
Use those columns to assess a requested constraint such as historical market
capitalization. If only price and volume are available, a trailing
dollar-volume estimate can describe liquidity when its units are known.

Run admission takes a client UUID. The same new-version run ID and normalized
request return the existing receipt even if model settings have since changed.
Changing an admitted request under the same ID is a conflict. Legacy run IDs
remain reserved and are never restarted on a repeated submission. If a result
is uncertain, read that exact ID before deciding to submit it again.

## Deployment and authorization

Configure the service with **Settings** or `alphazonai settings` over loopback
or an SSH tunnel. To authorize remote settings, save the Cloudflare Access
team slug and application AUD in **Data settings**. The browser uses its
Access session and the CLI accepts the application JWT via `--token-file`.
For remote CLI research writes, set an agent token in **Data settings** and access the
instance over HTTPS. Strategy operations and performance uploads use the
strategy token from **NautilusTrader settings**. Pass the corresponding
credential with `--token-file FILE`. The service rejects browser-origin
research and strategy writes. Keep the reporting API on a private interface
or behind a trusted access layer.

A successful push installs the exact validated strategy package as inactive.
It does not attach an exchange account, start Nautilus live trading, or
activate the package. The dashboard should show the actual receipt state and
never manufacture price or equity history from aggregate metrics.
