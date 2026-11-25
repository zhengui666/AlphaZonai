# AlphaZonai

CogAlpha search and evolution on Pi Durable, with NautilusTrader market data.

- Start, pause, stop and resume research runs.
- Inspect candidate code, reviews, scores, and ancestry.
- Export selected factors without placing orders or running a strategy.
- English and Simplified Chinese.

## Run

Pull the GHCR image for a published version. Mount the existing NautilusTrader
catalog read-only and keep a persistent state volume. Set `OPENAI_API_KEY` in
your shell or an environment file outside the repository.

```sh
docker run --rm -p 127.0.0.1:8787:8787 \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  -e OPENAI_API_KEY -v alphazonai-state:/state \
  --mount type=bind,source="$PWD/catalog",destination=/catalog,readonly \
  ghcr.io/zhengui666/alphazonai:v0.1.0
```

Open http://127.0.0.1:8787. The Linux host must allow nested user and network
namespaces for Bubblewrap. The Docker flags permit the nested sandbox; the
service does not run privileged. Run only on a self-hosted machine you control.
Without a functioning sandbox, the research run stops before asking the model.

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
change an existing run. **Standard** requests OpenAI's default tier; **Fast**
requests the priority tier and may cost more or be unavailable for an account.
**Provider default** doesn't send a speed override. Configure via the loopback
deployment URL (or an SSH tunnel) and do not expose the service directly.
