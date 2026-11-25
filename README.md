# AlphaZonai

CogAlpha search and evolution on Pi Durable, with NautilusTrader market data.

- Use the CLI to start, pause, stop and resume research runs.
- Read charts and reports in the Web dashboard. Only Model Settings are editable there.
- Inspect candidate code, reviews, scores, and ancestry.
- Export research factors or generate a free-form native Nautilus strategy.
- Backtest on one configured instance and stage an inactive package on another.
- English and Simplified Chinese.

## Run

Pull the GHCR image for a published version. Mount the existing NautilusTrader
catalog read-only and keep a persistent state volume. Optionally set
`OPENAI_API_KEY` outside the repository, or connect a provider in Model Settings.

```sh
docker run --rm -p 127.0.0.1:8787:8787 \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  -e OPENAI_API_KEY -v alphazonai-state:/state \
  --mount type=bind,source="$PWD/catalog",destination=/catalog,readonly \
  ghcr.io/zhengui666/alphazonai:"${ALPHA_VERSION:?choose a published tag}"
```

Open http://127.0.0.1:8787. The Linux host must allow nested user and network
namespaces for Bubblewrap. The Docker flags permit the nested sandbox; the
service does not run privileged. Run only on a self-hosted machine you control.
Without a functioning sandbox, the research run stops before asking the model.

## CLI and external agents

Use the [external agent skill](SKILL.md) and the [CLI workflows](cli/WORKFLOWS.md).
The standalone `cli/alphazonai.mjs` from the release works with Node.js 24,
without installing application dependencies. The same executable is installed
as `alphazonai` in the service image. For an existing named container:

```sh
docker exec -e ALPHAZONAI_URL=http://127.0.0.1:8787 alphazonai alphazonai runs list
```

Point external agents at your private AlphaZonai URL. Set `ALPHA_AGENT_TOKEN`
for remote research writes. Set `ALPHA_STRATEGY_TOKEN` separately if the agent
is authorized to build or stage strategies. The
[CLI and reporting design](docs/agent-cli-design.md) describes the boundaries.

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

## Model settings

On the machine hosting the service, open **Model settings** to connect an
OpenAI API key or sign in to ChatGPT with Pi's device flow, then save defaults for the model, reasoning effort and speed.
An `OPENAI_API_KEY` supplied by the host still works. The key saved in the UI
overrides the environment key; disconnect only deletes the key saved by the
UI. Keys are not returned to the browser or passed into factor processes.

Choices come from the installed Pi provider, not a separate list in
AlphaZonai. A new run records these choices, and changes to defaults do not
change an existing run. **Standard** requests OpenAI's default tier; **Fast** requests the priority tier only for [documented API models](https://openai.com/api-fast-mode/). Account eligibility and the effective tier can differ. ChatGPT subscriptions do not use that API pricing matrix.
**Provider default** doesn't send a speed override. Configure via the loopback
deployment URL (or an SSH tunnel) and do not expose the service directly.
