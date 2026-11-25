# AlphaZonai
Pi Durable owns agent execution, scheduling, and persistence. NautilusTrader
owns market data and trade execution. Keep the app, workflows, and Web API thin.
See [method mapping](docs/method-mapping.md) and [research design](docs/design.md).
Do not run a paper benchmark, simulated trading, or live trading on behalf of a
research request. Use the isolated evaluator for arbitrary generated code.
