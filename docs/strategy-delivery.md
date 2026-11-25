# Strategy delivery

AlphaZonai's research output is candidate-factor evidence. Strategy delivery turns
that evidence into a separate NautilusTrader artifact. A factor is not an order
rule: the generated strategy specifies how to combine inputs, open and exit a
position, size it, and stop out. The operator selects the research run and later
validation window. The deployment target may be a different local or remote
Nautilus environment.

## User flow

1. Finish factor research with at least one elite candidate.
2. Under **Strategy delivery**, select a backtest instance and enter UTC dates
   after the research interval. Select **Generate and backtest**.
3. Pi Durable asks the run's model to design a strict JSON strategy plan from
   shortlisted factor metadata and scores. The model receives no deployment
   identity, runtime secrets, or remote execution tool. We do not copy generated
   factor Python into the trading node. A trusted strategy runtime implements
   the validated plan with native subscriptions and orders.
4. The selected backtest instance runs the exact runtime and plan in its native
   Nautilus engine, against its own read-only Catalog. Retrieve the evidence and
   exact importable config from the strategy package.
5. Select a deployment instance and **Push inactive package**. The target
   constructs the same strategy with Nautilus `StrategyFactory`, stages the
   runtime and its config, and returns a receipt with its instance name.
   **Staged** means files are ready to load. It does not mean paper or live
   orders were sent or a node was started.

The initial production family is a transparent long-or-flat, closed external
minute-bar strategy. The model chooses weights and scales over return, relative
volume, intrabar range and close location, plus per-term lookbacks, entry/exit
thresholds, a close-based stop and allocation fraction. It can propose multiple
inputs. This is a separate strategy hypothesis, not a promise to preserve the
mathematics of arbitrary factor Python. Adding other approved signal families
or execution styles is a versioned runtime extension, not an account integration.

## Operator configuration

Set `ALPHA_STRATEGY_TARGETS` to a mounted JSON file and
`ALPHA_STRATEGY_TOKEN` to a long random secret the operator enters in the UI.
Use a private interface, SSH forwarding, or an authenticated TLS reverse
proxy. Only strategy writes require the token. Do not expose the whole app
as an unauthenticated public service. No exchange credentials belong here.
Targets are an operator-managed allowlist, not hostnames supplied by a client.

```json
[
  {"id":"history","label":"Historical runner","kind":"local","roles":["backtest"],"profile":"/etc/alpha/backtest.json"},
  {"id":"runtime","label":"Remote strategy host","kind":"ssh","roles":["deploy"],"alias":"alpha-runtime","sshConfig":"/etc/alpha/ssh/config"}
]
```

A target can have both roles or profiles may be fully separate, including
remote backtests. The SSH target must have Python with the exact Nautilus
version below, and copies of the two files `quant/strategy_receiver.py` and
`quant/alpha_signal_strategy.py` from the same AlphaZonai release, in the same
directory. Configure the client's mounted SSH config with an identity, user,
and pinned host key. Use a restricted deployment account and a dedicated key
whose SSH forced command runs only

```text
/path/to/python /path/to/strategy_receiver.py --profile /etc/alpha/receiver.json
```

Disable shell fallback, TTY, forwarding and agent forwarding for that key. For
`local`, use a mounted profile and the app's `ALPHA_PYTHON` environment.
Give the receiver a writable staging directory for deploy and read-only
Catalog access for backtest. Do not provide broker credentials to a receiver.

Here is the profile shape (substitute real Nautilus IDs and an actual Catalog):

```json
{
  "instance":"history",
  "allow":["backtest"],
  "catalog":"/catalog",
  "quantities":{"ASSET-PERP.HYPERLIQUID-1-MINUTE-LAST-EXTERNAL":"0.020"},
  "venues":{"HYPERLIQUID":{"account_type":"MARGIN","starting_balances":["10000 USDC"],"default_leverage":1}},
  "fills":{"latency_ns":10000000,"prob_slippage":0}
}
```

`quantities` maps full Nautilus external minute-bar identifiers to the maximum
quantity for that instrument, not to an exchange API symbol. Put the intended
market universe in the profile; no symbol is built into the strategy. Data
comes through Nautilus `ParquetDataCatalog`, and missing streams or instrument
definitions fail the job. Use a venue's native fees and configure an appropriate
slippage model for the test. The numeric `prob_slippage` uses Nautilus's
one-tick probabilistic fill model; this does not simulate L2 queues.

The deployment profile contains `instance`, `allow:["stage"]`, the same
`quantities`, and a dedicated pre-created `staging_dir`. It does not need a
history catalog or account balances. v1 pins NautilusTrader 1.231.0 and requires
the same instruments and sizes that were backtested. A change requires a new
backtest, not silent rewriting on the deployment machine.

## Data and execution

- **Research:** existing native Pi Durable tasks, Nautilus Catalog, isolated
  Python evaluator, and persisted factor audit trail remain unchanged.
- **Generation:** Pi Durable Build task owns the model request ID and saves the
  validated plan before invoking the runner. Its settings include requested
  backtest interval, target ID, and source candidate IDs.
- **Validation:** the interval must start at or after the exclusive research
  end. The native engine consumes ordered day batches with no sampling.
  Data availability, completed execution, and at least one filled order are
  technical acceptance evidence. Profitability, out-of-sample robustness and
  portfolio fit require separate judgment.
- **Push:** the persisted package and selected allowlisted target are the only
  inputs to a separate durable operation. The receiver validates package,
  version, native import and matching market configuration, then atomically
  stages three files beneath the UUID. Repeating the same push compares bytes
  and returns the same outcome. Different files are never overwritten.
- **Activation:** the app deliberately does not activate any strategy or start
  a node. When the operator chooses to run it, add the staged directory to
  the existing Nautilus node environment's Python import path and supply the
  staged `importable-strategy.json` through its existing
  `ImportableStrategyConfig` list. The operator owns adapters, credentials,
  venue routing, activation and rollback. Use a dedicated appropriately
  configured strategy account; this version will not take over already open
  inventory, persist signals across a live restart, or guarantee fills.
  Close-based stops are strategy decisions at bar arrival, not exchange-hosted
  guaranteed stop orders. Native risk and exchange constraints still apply.

## Protocol

- `GET /api/strategy-targets` returns only target IDs, display names and roles.
- `POST /api/runs/:researchId/strategies` with Bearer token: send
  `{"action":"build","id":UUID,"target":backtestId,"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}`
  or `{"action":"push","id":strategyId,"target":deploymentId}`.
  Keep the same UUID on retries for a single build. Read status and receipts
  through the existing run snapshot or SSE stream.
- `GET /api/runs/:researchId/strategies?download=:strategyId` returns the
  evidence bundle. The receiver puts the importable config, trusted Python
  module, and evidence JSON together at the destination.
- Receiver protocol is one JSON message on stdin and one verified JSON
  receipt on stdout. Both carry schema, operation and UUID. No arbitrary
  branch commands or shell input travel in the request. SSH host-key
  authentication and the forced command protect the transport boundary.
  Separate target instances are trusted members of the user's infrastructure;
  v1 does not attempt to attest against a compromised target.

## Verification

The receiver round-trip test writes native Catalog data, executes the native
backtest, confirms actual fills and stages the exact native config on a
different receiver profile. It exercises repeated delivery and mismatched
market configuration. This does not connect to a real exchange or measure
strategy returns. An infrastructure acceptance can repeat the same protocol
with two SSH hosts, configured Catalog data and a selected receiver identity.
No release claim should say a remote site or live account has been tested
unless its receipt was independently observed.

Upstream reference pinned to the package under test:
[Nautilus StrategyFactory v1.231.0](https://github.com/nautechsystems/nautilus_trader/blob/v1.231.0/nautilus_trader/trading/config.py),
[BacktestEngine v1.231.0](https://github.com/nautechsystems/nautilus_trader/blob/v1.231.0/nautilus_trader/backtest/engine.pyx).
