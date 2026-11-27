import asyncio
from datetime import datetime, timezone
from decimal import Decimal
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from nautilus_trader.cache.cache import Cache
from nautilus_trader.model.currencies import USD
from nautilus_trader.model.enums import OmsType, OrderSide
from nautilus_trader.model.identifiers import ClientOrderId, PositionId, StrategyId, TradeId, VenueOrderId
from nautilus_trader.model.objects import Money
from nautilus_trader.model.position import Position
from nautilus_trader.test_kit.providers import TestInstrumentProvider
from nautilus_trader.test_kit.stubs.events import TestEventStubs
from nautilus_trader.test_kit.stubs.execution import TestExecStubs

from quant.performance import _import_report, _next_capture, currency_summary, performance_report, publish_daily_performance


class PerformanceTest(unittest.TestCase):
    def test_daily_capture_keeps_cross_day_positions_and_only_in_window_fills(self):
        midnight = datetime(2025, 1, 1, 16, tzinfo=timezone.utc)
        ns = int(midnight.timestamp()) * 1_000_000_000
        cache, account = Cache(), TestExecStubs.cash_account()
        cache.add_account(account)
        instrument = TestInstrumentProvider.default_fx_ccy("AUD/USD")
        strategy = StrategyId("Trend-001")
        order = TestExecStubs.make_accepted_order(instrument=instrument, order_side=OrderSide.BUY,
                                                  strategy_id=strategy, account_id=account.id, quantity=instrument.make_qty(100))
        position = None
        for index, event_ns in enumerate([ns - 1, ns, ns - 2]):
            fill = TestEventStubs.order_filled(order, instrument, position_id=PositionId("CARRY-1"),
                    last_qty=instrument.make_qty([25, 50, 25][index]), trade_id=TradeId(str(index)),
                    commission=Money(1, USD), ts_event=event_ns)
            order.apply(fill)
            if position is None:
                position = Position(instrument, fill)
            else:
                position.apply(fill)
        cache.add_order(order)
        cache.add_position(position, OmsType.NETTING)
        report = performance_report(SimpleNamespace(cache=cache, instance_id=uuid4()), mode="paper",
                                    account_id=str(account.id), strategy_id=str(strategy), coverage_start=midnight)
        self.assertEqual([f["tradeId"] for f in report["fills"]], ["1"])
        self.assertEqual(Decimal(report["currencies"][0]["fees"]), 1)
        retained, = report["positions"]
        self.assertLess(retained["opened"], report["coverageStart"])
        self.assertEqual(retained["tradeIds"], ["1"])
        self.assertEqual(retained["openingTradeId"], "0")
        self.assertEqual(Decimal(retained["quantity"]), 100)

    def test_native_history_is_scoped_and_snapshots_are_not_counted_twice(self):
        cache = Cache()
        account = TestExecStubs.cash_account()
        cache.add_account(account)
        node = SimpleNamespace(cache=cache, instance_id=uuid4())
        instrument = TestInstrumentProvider.default_fx_ccy("AUD/USD")
        strategy = StrategyId("Trend-001")
        position_id = PositionId("TEST-001")
        events = []
        for number, (side, price, owner) in enumerate((
            (OrderSide.BUY, 1.0, strategy), (OrderSide.SELL, 1.1, strategy),
            (OrderSide.BUY, 1.2, StrategyId("Other-002")),
        )):
            order = TestExecStubs.make_accepted_order(
                instrument=instrument, order_side=side, strategy_id=owner, account_id=account.id,
                quantity=instrument.make_qty(100), client_order_id=ClientOrderId(f"O-{3-number}"),
                venue_order_id=VenueOrderId(str(number)),
            )
            fill = TestEventStubs.order_filled(
                order, instrument, last_px=instrument.make_price(price),
                position_id=position_id if owner == strategy else PositionId("OTHER-002"),
                commission=Money(1, USD), ts_event=1_700_000_000_000_000_001 + number,
            )
            order.apply(fill)
            cache.add_order(order)
            events.append(fill)
        position = Position(instrument, events[0])
        position.apply(events[1])
        cache.add_position(position, OmsType.NETTING)
        cache.snapshot_position(position)
        cache.add_position(Position(instrument, events[2]), OmsType.HEDGING)

        report = performance_report(node, mode="paper", account_id=str(account.id), strategy_id=str(strategy),
                                    parameters={"period": 20, "short": False})
        json.dumps(report, allow_nan=False)
        self.assertEqual(report["parameters"], {"period": 20, "short": False})
        self.assertEqual(len(report["positions"]), 1)
        self.assertEqual([f["tradeId"] for f in report["fills"]], report["positions"][0]["tradeIds"])
        self.assertEqual([f["orderId"] for f in report["fills"]], ["O-3", "O-2"])
        result, = report["currencies"]
        self.assertEqual((Decimal(result["realizedPnl"]), Decimal(result["fees"]), result["closedCount"]), (8, 2, 1))
        self.assertEqual(result["curve"][-1]["time"], report["positions"][0]["closed"])
        self.assertEqual(report["balances"][0]["total"], "1000000.00")

    def test_drawdown_uses_simultaneous_closes_and_zero_baseline(self):
        amounts = [(10, Decimal("-3")), (20, Decimal("7")), (20, Decimal("-2")), (30, Decimal("-4"))]
        result = currency_summary("USD", amounts, Decimal("0.50"), 9)
        self.assertEqual([point["pnl"] for point in result["curve"]], ["0", "-3", "2", "-2"])
        self.assertEqual((result["maxDrawdown"], result["closedCount"], result["winRate"]), ("4", 4, 0.25))
        self.assertAlmostEqual(result["profitFactor"], 7/9)
        empty = currency_summary("BNB", [], Decimal("0.1"), None)
        self.assertEqual((empty["curve"], empty["winRate"], empty["profitFactor"]), ([], None, None))


class DailyPublisherTest(unittest.IsolatedAsyncioTestCase):
    def test_oversize_import_does_not_block_following_captures(self):
        response = SimpleNamespace(returncode=3, stderr='{"error":{"httpStatus":413}}')
        with patch("quant.performance.subprocess.run", return_value=response) as run, \
             self.assertLogs("quant.performance", level="ERROR"):
            _import_report({"id": str(uuid4())}, "strategy.token", None)
        self.assertEqual(run.call_args.args[0], [
            "alphazonai", "performance", "import", "--report-file", "-", "--token-file", "strategy.token",
        ])

    async def test_retries_the_same_snapshot_before_capturing_again(self):
        report = {"id": str(uuid4()), "asOf": "2026-11-27T16:01:00+00:00"}
        response = SimpleNamespace(returncode=0)
        origin = "https://research.example"
        with patch("quant.performance.performance_report", return_value=report) as capture, \
             patch("quant.performance.subprocess.run", side_effect=[OSError("offline"), response]) as send, \
             patch("quant.performance.asyncio.sleep", side_effect=[None, asyncio.CancelledError]) as sleep:
            with self.assertLogs("quant.performance"), self.assertRaises(asyncio.CancelledError):
                await publish_daily_performance(object(), mode="paper", account_id="SIM-001", strategy_id="Trend-001",
                                                token_file="strategy.token", url=origin, parameters=lambda: {"period": 9})
        self.assertEqual(capture.call_count, 1)
        self.assertEqual(capture.call_args.kwargs["parameters"], {"period": 9})
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args_list[0], send.call_args_list[1])
        self.assertEqual(json.loads(send.call_args.kwargs["input"]), report)
        self.assertEqual(send.call_args.args[0], [
            "alphazonai", "performance", "import", "--report-file", "-", "--token-file", "strategy.token", "--url", origin,
        ])
        self.assertEqual(sleep.call_args_list[0].args, (300,))
        self.assertEqual(_next_capture(report["asOf"]).isoformat(), "2026-11-28T00:05:00+08:00")
        self.assertEqual(_next_capture("2026-11-27T16:05:00Z").isoformat(), "2026-11-29T00:05:00+08:00")
