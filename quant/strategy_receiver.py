"""Nautilus-side receiver. Backtest or stage an inactive importable strategy; never start a live node."""
import argparse
from importlib.metadata import version
import json
from pathlib import Path
import re
import sys
import tempfile
from decimal import Decimal

import pandas as pd

from alpha_signal_strategy import clean_plan


SCHEMA = 1
NAUTILUS = "1.231.0"
RUNTIME_FILE = Path(__file__).with_name("alpha_signal_strategy.py")
ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def normalize_time(value):
    if not isinstance(value, str):
        raise ValueError("Invalid UTC time")
    parsed = pd.Timestamp(value)
    if parsed.tzinfo is None:
        raise ValueError("Explicit UTC time required")
    return parsed.tz_convert("UTC")


def package_config(plan, market):
    from nautilus_trader.model.data import BarType
    from nautilus_trader.model.objects import Quantity
    if not isinstance(market, dict) or not market:
        raise ValueError("No configured instruments")
    instruments = set()
    for b, quantity in market.items():
        bt = BarType.from_str(b)
        if str(bt.spec) != "1-MINUTE-LAST" or not b.endswith("-EXTERNAL") or bt.instrument_id in instruments:
            raise ValueError("Expected one external 1-MINUTE-LAST stream per instrument")
        if not isinstance(quantity, str) or Quantity.from_str(quantity).as_decimal() <= 0:
            raise ValueError("Positive exact order size required")
        instruments.add(bt.instrument_id)
    return {"strategy_path": "alpha_signal_strategy:AlphaSignalStrategy",
            "config_path": "alpha_signal_strategy:AlphaSignalConfig",
            "config": {"plan": clean_plan(plan), "quantities": market}}


def build_strategy(config):
    from nautilus_trader.trading.config import ImportableStrategyConfig, StrategyFactory
    return StrategyFactory.create(ImportableStrategyConfig(**config))


def run_backtest(profile, request):
    from nautilus_trader.backtest.engine import BacktestEngine
    from nautilus_trader.backtest.config import BacktestEngineConfig
    from nautilus_trader.backtest.models import FillModel, LatencyModel
    from nautilus_trader.common.config import LoggingConfig
    from nautilus_trader.model.data import Bar, BarType
    from nautilus_trader.model.enums import AccountType, OmsType
    from nautilus_trader.model.identifiers import Venue
    from nautilus_trader.model.objects import Money, Quantity
    from nautilus_trader.persistence.catalog.parquet import ParquetDataCatalog
    start, end, research_end = map(normalize_time, (request["start"], request["end"], request["research_end"]))
    if start < research_end or end <= start:
        raise ValueError("Use a later, non-overlapping backtest interval")
    config = package_config(request["plan"], profile["quantities"])
    strategy = build_strategy(config)
    types = [BarType.from_str(b) for b in config["config"]["quantities"]]
    catalog = ParquetDataCatalog(profile["catalog"])
    expected = {str(b.instrument_id) for b in types}
    instruments = {str(i.id): i for i in catalog.instruments() if str(i.id) in expected}
    if set(instruments) != expected:
        raise ValueError("Missing native catalog instrument definition")
    for bt in types:
        order_size = Quantity.from_str(profile["quantities"][str(bt)]).as_decimal()
        instrument = instruments[str(bt.instrument_id)]
        if order_size % instrument.size_increment.as_decimal() or instrument.min_quantity is not None and order_size < instrument.min_quantity.as_decimal():
            raise ValueError("Configured instrument quantity does not meet minimum or increment")
    settings = profile["venues"]
    venues = {str(bt.instrument_id.venue) for bt in types}
    if venues != set(settings):
        raise ValueError("Backtest venue settings must match the market universe")
    fill = profile["fills"]
    if type(fill["latency_ns"]) is not int or fill["latency_ns"] < 0 or not 0 <= fill["prob_slippage"] <= 1:
        raise ValueError("Invalid simulation latency or slippage")
    engine = BacktestEngine(BacktestEngineConfig(logging=LoggingConfig(bypass_logging=True)))
    try:
        for name, venue in settings.items():
            engine.add_venue(venue=Venue(name), oms_type=OmsType.NETTING,
                             account_type=AccountType[venue["account_type"]],
                             default_leverage=Decimal(str(venue.get("default_leverage", 1))),
                             starting_balances=[Money.from_str(x) for x in venue["starting_balances"]],
                             fill_model=FillModel(prob_slippage=float(fill["prob_slippage"]), random_seed=1),
                             latency_model=LatencyModel(base_latency_nanos=fill["latency_ns"]))
        for instrument in instruments.values():
            engine.add_instrument(instrument)
        engine.add_strategy(strategy)

        # Preserve the native event stream in chronological day batches, with no sampling.
        observed = dict.fromkeys([str(t) for t in types], 0)
        previous = {}
        lower = start
        while lower < end:
            upper = min(end, lower + pd.Timedelta(days=1))
            rows = catalog.query(Bar, identifiers=list(observed), start=lower.value, end=upper.value-1)
            for bar in rows:
                key = str(bar.bar_type)
                if key not in observed or not lower.value <= bar.ts_init < upper.value:
                    raise ValueError("Nautilus catalog returned unexpected bar stream or timestamp")
                if previous.get(key, -1) >= bar.ts_init:
                    raise ValueError("Unexpected duplicate or unordered bar timestamp")
                previous[key] = bar.ts_init
                observed[key] += 1
            if rows:
                engine.add_data(rows)
                engine.run(streaming=True)
                engine.clear_data()
            lower = upper
        warmup = max(s["lookback"] for s in config["config"]["plan"]["signals"]) + 1
        if any(n < warmup for n in observed.values()):
            raise ValueError("Insufficient bars for one or more configured instruments")
        engine.end()
        result = engine.get_result()
        fills = sum(float(o.filled_qty) > 0 for o in engine.cache.orders())
        if not fills:
            raise ValueError("No executed orders in backtest")
        metrics = {"orders": result.total_orders, "filledOrders": fills, "positions": result.total_positions,
                   "iterations": result.iterations, "bars": sum(observed.values()), "instruments": len(observed),
                   "first": start.isoformat(), "endExclusive": end.isoformat()}
        # Round-trip through JSON and remove non-finite optional native stats.
        def sanitize(x):
            import math
            if isinstance(x, dict):
                return {str(k): sanitize(v) for k, v in x.items()}
            if isinstance(x, (int, float)):
                return x if math.isfinite(x) else None
            if x is None or isinstance(x, str):
                return x
            return str(x)
        metrics["pnl"] = sanitize(result.stats_pnls)
        metrics["returns"] = sanitize(result.stats_returns)
        return {"schema": SCHEMA, "kind": "backtest", "id": request["id"], "nautilus": NAUTILUS,
                "strategy": config, "metrics": metrics}
    finally:
        engine.dispose()


def stage(profile, request):
    bundle = request["bundle"]
    conf = package_config(bundle["strategy"]["config"]["plan"], profile["quantities"])
    if bundle["strategy"] != conf:
        raise ValueError("Destination market and size configuration differs from the validated strategy")
    if (bundle["schema"], bundle["nautilus"], bundle["id"]) != (SCHEMA, NAUTILUS, request["id"]):
        raise ValueError("Unsupported strategy package")
    receipt = bundle["backtest"]
    if (receipt["schema"], receipt["kind"], receipt["id"], receipt["nautilus"], receipt["strategy"]) != (SCHEMA, "backtest", request["id"], NAUTILUS, conf) or receipt["metrics"]["filledOrders"] < 1:
        raise ValueError("Missing matching backtest evidence")
    build_strategy(conf)  # resolves and instantiates the same native importable config; never builds a trading node
    root = Path(profile["staging_dir"]).resolve(strict=True)
    dest = root / request["id"]
    expected = {
        "alpha_signal_strategy.py": RUNTIME_FILE.read_bytes(),
        "importable-strategy.json": json.dumps(conf, sort_keys=True, ensure_ascii=False, allow_nan=False).encode(),
        "strategy-package.json": json.dumps(bundle, sort_keys=True, ensure_ascii=False, allow_nan=False).encode(),
    }
    with tempfile.TemporaryDirectory(prefix=".alpha-", dir=root) as tmp:
        work = Path(tmp) / "package"
        work.mkdir()
        for name, content in expected.items():
            (work / name).write_bytes(content)
        try:
            work.rename(dest)
        except OSError:
            # The same request may have succeeded before an SSH disconnect. Never replace different content.
            if not dest.is_dir() or dest.is_symlink() or any((dest / n).is_symlink() or (dest / n).read_bytes() != c for n,c in expected.items()):
                raise
    return {"schema": SCHEMA, "kind": "stage", "id": request["id"], "nautilus": NAUTILUS,
            "instance": profile["instance"], "status": "staged", "activated": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    args = parser.parse_args()
    profile = json.loads(args.profile.read_text())
    request = json.load(sys.stdin)
    if version("nautilus_trader") != NAUTILUS or request.get("schema") != SCHEMA or not ID.fullmatch(request.get("id", "")):
        raise ValueError("Unsupported NautilusTrader version or request")
    op = request.get("kind")
    if op not in profile["allow"]:
        raise ValueError("Operation not allowed by this instance")
    result = run_backtest(profile, request) if op == "backtest" else stage(profile, request) if op == "stage" else None
    if result is None:
        raise ValueError("Unsupported receiver operation")
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",",":")))


if __name__ == "__main__":
    main()
