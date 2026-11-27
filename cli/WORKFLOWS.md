# AlphaZonai external agent CLI

Use the CLI from the same release as the service. The command examples assume
`node cli/alphazonai.mjs` is installed as `alphazonai`. No dependency install is
needed for this CLI. The default origin is `http://127.0.0.1:25447`. Set
`ALPHAZONAI_URL` or pass `--url` for another instance; non-loopback transport
requires HTTPS. Never redirect a write to a second instance after an error.

## Output and discovery

- `alphazonai schema` lists all commands with option types and documented access.
  `alphazonai schema strategies push` scopes discovery to one command.
- `doctor` reads advertised models and targets. It does not start a research
  run, spend model quota, validate tokens, or prove a receiver is reachable.
- Successful commands emit one `{ok:true,contract:1,data,meta}` object to stdout.
  With `--pretty` the JSON is indented. Errors emit one
  `{ok:false,contract:1,error:{code,message,...}}` object to stderr and exit
  nonzero: 2 input/output, 3 API or missing evidence, 4 transport/response, 5
  wait timeout, 1 unexpected. Check both exit code and the terminal state.
- Add `--dry-run` to writes to inspect the request locally. It reads explicit
  input files but performs no network request. It does not prove server
  authorization, funds, data coverage or that a target exists.
- Watched terminal run states: completed, failed, stopped; paused also returns.
  Strategy states: validated or failed. Staging states: staged or failed.
  Timeout is local only. To resume observation use the same IDs.
- `--output` on an export writes the raw artifact at an exclusively created
  path. Without it, inspect `data` in the JSON envelope.

## From research to staging

The dates below are illustrative. Choose ranges known to be in the Catalog.
Replace variables with the actual generated UUIDs and IDs returned by targets.

```sh
alphazonai doctor
alphazonai id
alphazonai runs start --id "$RUN_ID" --start 2026-10-01 --end 2026-10-08 \
  --direction-file direction.txt --dry-run
alphazonai runs start --id "$RUN_ID" --start 2026-10-01 --end 2026-10-08 \
  --direction-file direction.txt
alphazonai runs wait --id "$RUN_ID" --wait-ms 30000
alphazonai runs get --id "$RUN_ID"
alphazonai strategies targets
alphazonai id
alphazonai strategies build --id "$RUN_ID" --strategy "$STRATEGY_ID" \
  --target "$BACKTEST_TARGET" --start 2026-10-08 --end 2026-10-15
alphazonai strategies wait --id "$RUN_ID" --strategy "$STRATEGY_ID"
alphazonai strategies export --id "$RUN_ID" --strategy "$STRATEGY_ID" --output strategy.json
```

After a separate request to stage the validated version:

```sh
alphazonai strategies push --id "$RUN_ID" --strategy "$STRATEGY_ID" \
  --target "$DEPLOY_TARGET" --dry-run
alphazonai strategies push --id "$RUN_ID" --strategy "$STRATEGY_ID" \
  --target "$DEPLOY_TARGET"
alphazonai strategies wait --id "$RUN_ID" --strategy "$STRATEGY_ID" --target "$DEPLOY_TARGET"
```

Verify the returned receipt has `status: staged` and `activated: false`.
Distinguish a failed or unknown outcome from a completed action.

## Paper and live performance

Export a snapshot from an existing Nautilus node as described in
[performance and trade review](../docs/performance.md). Import it using the
strategy token and retain the report ID returned by the service.

```sh
alphazonai performance import --report-file report.json
alphazonai performance list
alphazonai performance show --id "$REPORT_ID"
```

Retry an interrupted import with the same file. Each new capture gets its own
report ID, so earlier snapshots remain available.

The review list shows the daily schedule status and IDs for automatic and
manual reviews. Use one of those IDs to read the findings.

```sh
alphazonai performance review-list
alphazonai performance review-show --review "$REVIEW_ID"
```

For a manual review, set a default model in the local dashboard. Use a fresh
review UUID and optionally add comparison reports and a question. Reuse the review UUID
and identical inputs if the response is lost.

```sh
alphazonai performance review --id "$LIVE_REPORT" --with "$PAPER_REPORT" \
  --review "$REVIEW_ID" --language en \
  --objective "Did costs explain the difference? Evaluate changing the entry threshold."
alphazonai performance review-show --review "$REVIEW_ID"
```

`diagnosing` and `deciding` are in progress. A completed review includes a
judgment for the strategy, portfolio and parameters. A failed second stage
preserves the first stage's diagnosis.

## Design references

The [official Lark CLI](https://github.com/larksuite/cli) informed the
discoverable schema, write previews, and distinct JSON success/error streams.
The [Agent Skills specification](https://agentskills.io/specification)
informed the trigger description and the split between the concise skill
and workflow detail. AlphaZonai keeps authenticated workflows explicit and
does not expose a generic API passthrough or activation command.
