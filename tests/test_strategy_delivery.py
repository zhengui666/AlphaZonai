"""Round-trip against the installed Nautilus engine and actual local receiver."""
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.persistence.catalog.parquet import ParquetDataCatalog
from nautilus_trader.test_kit.providers import TestInstrumentProvider

RECEIVER = Path(__file__).resolve().parents[1] / "quant" / "strategy_receiver.py"
ID = "23fe0453-c85f-4d64-a199-75f54ac7b180"
PLAN = {"title": "Causal Momentum", "signals": [{"kind": "return", "lookback": 1, "scale": 20, "weight": 1}],
        "entry": 0.1, "exit": 0, "stop_loss": 0.05, "allocation": 0.5, "max_positions": 1}


class StrategyDeliveryTest(unittest.TestCase):
    def test_native_backtest_and_stage_on_distinct_instances(self):
        with TemporaryDirectory() as sandbox:
            root = Path(sandbox)
            instrument = TestInstrumentProvider.btcusdt_perp_binance()
            bar_type = BarType.from_str(f"{instrument.id}-1-MINUTE-LAST-EXTERNAL")
            catalog_dir = root / "catalog"
            catalog_dir.mkdir()
            catalog = ParquetDataCatalog(str(catalog_dir))
            ts = int(datetime(2025, 3, 2, tzinfo=timezone.utc).timestamp()) * 1_000_000_000
            closes = [40_000, 41_000, 42_000, 43_000, 44_000, 42_000, 40_000, 43_000, 45_000, 44_000]
            bars = [
                Bar(bar_type, instrument.make_price(x), instrument.make_price(x + 10), instrument.make_price(x - 10),
                    instrument.make_price(x), instrument.make_qty(2), ts + i * 60_000_000_000, ts + i * 60_000_000_000)
                for i, x in enumerate(closes)
            ]
            catalog.write_data([instrument])
            catalog.write_data(bars)
            market = {str(bar_type): "0.020"}
            stage_dir = root / "deployment-receiver"
            stage_dir.mkdir()

            def receiver(profile, request):
                p = root / f'{profile["instance"]}.json'
                p.write_text(json.dumps(profile))
                return subprocess.run([sys.executable, str(RECEIVER), "--profile", str(p)],
                                      input=json.dumps({"schema": 1, "id": ID, **request}), text=True,
                                      capture_output=True, timeout=30)

            backtest = {"instance": "research", "allow": ["backtest"], "catalog": str(catalog_dir),
                        "quantities": market, "venues": {"BINANCE": {"account_type": "MARGIN", "starting_balances": ["10000 USDT"]}},
                        "fills": {"latency_ns": 10_000_000, "prob_slippage": 0}}
            req = {"kind": "backtest", "plan": PLAN, "start": "2025-03-02T00:00:00Z",
                   "end": "2025-03-03T00:00:00Z", "research_end": "2025-03-02T00:00:00Z"}
            rejected = receiver(backtest, {**req, "research_end": "2025-03-02T01:00:00Z"})
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("non-overlapping", rejected.stderr)
            completed = receiver(backtest, req)
            self.assertEqual(completed.returncode, 0, completed.stderr + completed.stdout)
            result = json.loads(completed.stdout)
            self.assertGreaterEqual(result["metrics"]["filledOrders"], 2)
            self.assertEqual(result["metrics"]["bars"], len(bars))
            bundle = {"schema": 1, "id": ID, "nautilus": "1.231.0", "strategy": result["strategy"], "backtest": result}
            live = {"instance": "separate-runtime", "allow": ["stage"], "quantities": market, "staging_dir": str(stage_dir)}
            bad = receiver({**live, "quantities": {str(bar_type): "0.100"}}, {"kind": "stage", "bundle": bundle})
            self.assertNotEqual(bad.returncode, 0)
            self.assertFalse((stage_dir / ID).exists())
            wrong_source = {**bundle, "backtest": {**result, "source": "# A different runtime"}}
            self.assertNotEqual(receiver(live, {"kind": "stage", "bundle": wrong_source}).returncode, 0)
            self.assertFalse((stage_dir / ID).exists())
            for _ in range(2):
                staged = receiver(live, {"kind": "stage", "bundle": bundle})
                self.assertEqual(staged.returncode, 0, staged.stderr)
                receipt = json.loads(staged.stdout)
                self.assertEqual(receipt["instance"], "separate-runtime")
                self.assertFalse(receipt["activated"])
            self.assertEqual(json.loads((stage_dir / ID / "importable-strategy.json").read_text()), result["strategy"])
            self.assertEqual((stage_dir / ID / "alpha_signal_strategy.py").read_text(), result["source"])
            self.assertEqual(sorted(x.name for x in stage_dir.iterdir()), [ID])
            if os.environ.get("ALPHA_TEST_SSH") == "1":
                from ssh_receiver import exercise_ssh
                exercise_ssh(root, backtest, live, {**req, "id": ID}, result["source"])
