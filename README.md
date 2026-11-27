# AlphaZonai

CogAlpha search and evolution on Pi Durable, with NautilusTrader market data.

- Use the CLI to start, pause, stop and resume research runs.
- Read charts and reports in the Web dashboard, configure the service in Settings and request AI performance reviews.
- Inspect candidate code, reviews, scores, and ancestry.
- Export research factors or generate a free-form native Nautilus strategy.
- Backtest on one configured instance and stage an inactive package on another.
- Schedule separate daily AI reviews of paper and live trading. Each reviews the previous day's strategy, portfolio and parameters down to native fills. See [performance and trade review](docs/performance.md).
- English and Simplified Chinese.

## Run

Replace `TAG` with a published image tag. Mount the existing NautilusTrader
catalog read-only and keep a persistent state volume.

```sh
docker run --rm --name alphazonai -p 127.0.0.1:8787:8787 \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  -v alphazonai-state:/state \
  --mount type=bind,source="$PWD/catalog",destination=/catalog,readonly \
  ghcr.io/zhengui666/alphazonai:TAG
```

Open http://127.0.0.1:8787. The Linux host must allow nested user and network
namespaces for Bubblewrap. The Docker flags permit the nested sandbox; the
service does not run privileged. Run only on a self-hosted machine you control.
Without a functioning sandbox, the research run stops before asking the model.

## Settings

Open **Settings** on the service host or through an SSH tunnel.
The local CLI reads and updates the same settings. [Open local settings](http://127.0.0.1:8787/#settings)

| Section | What you can change |
| --- | --- |
| Model settings | Connect an OpenAI API key or sign in to ChatGPT with Pi's device flow. Choose the default model, reasoning effort and speed. |
| NautilusTrader settings | Select the Python interpreter, configure local and SSH strategy targets, and set the strategy token for delivery and performance uploads. |
| Performance review settings | Enable daily reviews, set the Shanghai time (default 08:00) and choose the review language and objective. |
| Data settings | Set the Nautilus catalog path, Pi state directory, server address and port, and the agent token for research writes. |

```sh
alphazonai settings get
printf '%s\n' '{"time":"09:30","language":"en"}' | alphazonai settings set --section review --file -
```

Settings are stored in `state/settings.json` relative to the native service's
working directory, or in `/state/settings.json` inside the container. When
upgrading from environment variables or a `.env` file, enter those values in
Settings and reconnect your model provider.
Changes to the address, port and Pi state directory apply after restart.
Selecting a different state directory opens the history in that directory.
To keep the current history there, move the database and research files while
the service is stopped. The settings file stays in its fixed location.

Model choices come from the installed Pi provider and are recorded per run.
**Provider default** uses the provider's speed preference. **Standard**
requests OpenAI's default tier. **Fast** requests the priority tier on eligible
API models, subject to account access. [OpenAI API fast mode](https://openai.com/api-fast-mode/)

## CLI and external agents

Use the [external agent skill](SKILL.md) and the [CLI workflows](cli/WORKFLOWS.md).
The standalone `cli/alphazonai.mjs` from the release works with Node.js 24,
without installing application dependencies. The same executable is installed
as `alphazonai` in the service image. To list runs in the container above, use

```sh
docker exec alphazonai alphazonai runs list
```

Use `--url` to select another instance. For authenticated commands, pass
`--token-file FILE` with the agent or strategy token set in the dashboard.
[CLI and reporting design](docs/agent-cli-design.md)

## Strategy delivery

Configure separate local or SSH targets and complete a native backtest before pushing
an inactive package. See [strategy delivery](docs/strategy-delivery.md) for the
operator configuration, protocol and runtime requirements.

## Skills and source

[External Agent skill](SKILL.md) · [Method mapping](docs/method-mapping.md) ·
[Development and API](docs/design.md) ·
[Previous independent Nautilus skill](https://github.com/zhengui666/nautilus-quant-research)

Based on [Cognitive Alpha Mining via LLM-Driven Code-Based Evolution](https://aclanthology.org/2026.acl-long.538/).
The application implements the search method. It does not reproduce the authors'
market data, trained models, backtest results, or returns.
