"""Run a native Nautilus backtest. Called only inside the isolated receiver."""
import json
import contextlib
import math
import sys
from datetime import datetime, timezone

from nautilus_trader.backtest.config import BacktestRunConfig
from nautilus_trader.backtest.node import BacktestNode


def sanitize(x):
    if isinstance(x, dict):
        return {str(k): sanitize(v) for k, v in x.items()}
    if isinstance(x, (int, float)):
        return x if math.isfinite(x) else None
    if x is None or isinstance(x, str):
        return x
    return str(x)


def main():
    request = json.load(sys.stdin)
    raw = request["run"]
    # Nautilus end is inclusive; shift the exclusive HTTP end by one microsecond.
    # User date windows are whole UTC days. Keep the endpoint as a native ns integer.
    start = datetime.fromisoformat(request["start"])
    end = datetime.fromisoformat(request["end"])
    delta = end - datetime(1970, 1, 1, tzinfo=timezone.utc)
    end_ns = (delta.days * 86400 + delta.seconds) * 1_000_000_000 + delta.microseconds * 1000 - 1
    raw["start"], raw["end"] = start.isoformat(), end_ns
    raw["dispose_on_completion"], raw["raise_exception"] = False, True
    for data in raw["data"]:
        data["catalog_path"] = "/input/catalog"
        data["catalog_fs_protocol"] = "file"
        data.pop("catalog_fs_storage_options", None)
        data.pop("catalog_fs_rust_storage_options", None)
    engine = raw.setdefault("engine", {})
    engine["strategies"] = [request["strategy"]]
    engine.setdefault("logging", {})["bypass_logging"] = True
    sys.path.insert(0, "/work")
    config = BacktestRunConfig.parse(json.dumps(raw, allow_nan=False).encode())
    node = BacktestNode([config])
    try:
        reports = node.run()
        engine = node.get_engine(config.id)
        if len(reports) != 1 or engine is None:
            raise RuntimeError("Native backtest did not finish")
        report = reports[0]
        filled = sum(float(o.filled_qty) > 0 for o in engine.cache.orders())
        metrics = {"orders": report.total_orders, "filledOrders": filled, "positions": report.total_positions,
                   "iterations": report.iterations, "first": start.isoformat(), "endExclusive": end.isoformat(),
                   "pnl": sanitize(report.stats_pnls), "returns": sanitize(report.stats_returns)}
        return metrics
    finally:
        node.dispose()


if __name__ == "__main__":
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = main()
        print(json.dumps(result, allow_nan=False))
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__ + ": " + str(exc)[:220]}))
        raise SystemExit(1)
