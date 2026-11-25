# AlphaZonai

CogAlpha search and evolution on Pi Durable, with NautilusTrader market data.

- Start, pause, stop and resume research runs.
- Inspect candidate code, reviews, scores, and ancestry.
- Export candidate factors and turn shortlisted research into a Nautilus strategy.
- Backtest against one Nautilus instance and stage an inactive strategy on another.
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
