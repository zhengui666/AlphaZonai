"""Round-trip using an arbitrary generated-style module and the native Nautilus engine."""
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
MODULE = "alpha_strategy_" + ID.replace("-", "")
SOURCE = '''
import os
from nautilus_trader.config import StrategyConfig
from nautilus_trader.model.data import BarType
from nautilus_trader.model.enums import OrderSide, TimeInForce
from nautilus_trader.model.objects import Quantity
from nautilus_trader.trading.strategy import Strategy

assert "ALPHA_TEST_STAGE_PHASE" not in os.environ
assert not os.path.isdir("/workspace")

class FixtureConfig(StrategyConfig, frozen=True):
    bar_type: str

class FixtureStrategy(Strategy):
    def __init__(self, config):
        super().__init__(config)
        self.n = 0
        self.bt = BarType.from_str(config.bar_type)

    def on_start(self):
        self.subscribe_bars(self.bt)

    def on_bar(self, bar):
        self.n += 1
        if self.n in (3,6):
            side = OrderSide.BUY if self.n == 3 else OrderSide.SELL
            order = self.order_factory.market(self.bt.instrument_id, side, Quantity.from_str("0.010"),
                                              time_in_force=TimeInForce.IOC, reduce_only=self.n == 6)
            self.submit_order(order)
'''


class StrategyDeliveryTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("ALPHA_TEST_SSH") == "1", "native sandbox/SSH CI runner required")
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
            stage_dir = root / "deployment-receiver"
            stage_dir.mkdir()

            def receiver(profile, request):
                p = root / f'{profile["instance"]}.json'
                p.write_text(json.dumps(profile))
                return subprocess.run([sys.executable, str(RECEIVER), "--profile", str(p)],
                                      input=json.dumps({"schema": 2, "id": ID, **request}), text=True,
                                      env={**os.environ, "ALPHA_TEST_STAGE_PHASE": "1"},
                                      capture_output=True, timeout=30)

            backtest = {"instance": "research", "allow": ["backtest"], "catalog": str(catalog_dir),
                        "run": {"chunk_size": 1000,
                                "venues": [{"name": "BINANCE", "account_type": "MARGIN", "oms_type": "NETTING", "starting_balances": ["10000 USDT"]}],
                                "data": [{"data_cls": "nautilus_trader.model.data:Bar", "bar_types": [str(bar_type)]}]}}
            plan = {"title": "Generated strategy test", "source": SOURCE, "strategyClass": "FixtureStrategy",
                    "configClass": "FixtureConfig", "config": {"bar_type": str(bar_type)}}
            req = {"kind": "backtest", "plan": plan, "start": "2025-03-02T00:00:00Z",
                   "end": "2025-03-03T00:00:00Z", "research_end": "2025-03-02T00:00:00Z"}
            rejected = receiver(backtest, {**req, "research_end": "2025-03-02T01:00:00Z"})
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("non-overlapping", rejected.stderr)
            completed = receiver(backtest, req)
            self.assertEqual(completed.returncode, 0, completed.stderr + completed.stdout)
            result = json.loads(completed.stdout)
            self.assertGreaterEqual(result["metrics"]["filledOrders"], 2)
            self.assertEqual(result["source"], SOURCE)
            bundle = {"schema": 2, "id": ID, "nautilus": "1.231.0", "plan": plan,
                      "strategy": result["strategy"], "backtest": result}
            live = {"instance": "separate-runtime", "allow": ["stage"], "staging_dir": str(stage_dir)}
            changed = {**bundle, "plan": {**plan, "source": SOURCE + "\n# tampered"}}
            self.assertNotEqual(receiver(live, {"kind": "stage", "bundle": changed}).returncode, 0)
            self.assertFalse((stage_dir / ID).exists())
            for _ in range(2):
                staged = receiver(live, {"kind": "stage", "bundle": bundle})
                self.assertEqual(staged.returncode, 0, staged.stderr)
                receipt = json.loads(staged.stdout)
                self.assertEqual(receipt["instance"], "separate-runtime")
                self.assertFalse(receipt["activated"])
            self.assertEqual(json.loads((stage_dir / ID / "importable-strategy.json").read_text()), result["strategy"])
            self.assertEqual((stage_dir / ID / (MODULE + ".py")).read_text(), result["source"])
            self.assertEqual(sorted(x.name for x in stage_dir.iterdir()), [ID])
            from ssh_receiver import exercise_ssh
            exercise_ssh(root, backtest, live, {**req, "id": ID}, result["source"])
