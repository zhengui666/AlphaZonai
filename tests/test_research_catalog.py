import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd
from nautilus_trader.core.data import Data
from nautilus_trader.model.custom import customdataclass
from nautilus_trader.model.data import Bar, BarType, QuoteTick, TradeTick
from nautilus_trader.model.enums import AggressorSide
from nautilus_trader.model.events import AccountState
from nautilus_trader.model.identifiers import InstrumentId, TradeId
from nautilus_trader.model.objects import Price, Quantity
from nautilus_trader.persistence.catalog import ParquetDataCatalog
from nautilus_trader.test_kit.stubs.events import TestEventStubs

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "quant"))
from bridge import prepare


MINUTE = 60_000_000_000
START = pd.Timestamp("2026-01-01T12:30:00Z")
ASSET = "BTC.SIM"
MID = f"{ASSET}-5-MINUTE-MID-INTERNAL"
LAST = f"{ASSET}-5-MINUTE-LAST-EXTERNAL"


@customdataclass
class ResearchObservation(Data):
    instrument_id: InstrumentId
    reference: float
    venue_note: str


@customdataclass
class ResearchHeadline(Data):
    headline: str


@customdataclass
class AuctionReading(Data):
    series_id: str
    amount: float


def bar(series, minute, value):
    ts = START.value + minute * MINUTE
    price = Price.from_str(str(value))
    return Bar(BarType.from_str(series), price, price, price, price, Quantity.from_int(2), ts - 1, ts)


def tick(instrument, minute, value, trade_id):
    ts = START.value + minute * MINUTE
    return TradeTick(InstrumentId.from_str(instrument), Price.from_str(str(value)), Quantity.from_int(2),
                     AggressorSide.BUYER, TradeId(trade_id), ts - 1, ts)


class ResearchCatalog(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.uri = (Path(temp.name) / "catalog").as_uri()
        self.catalog = ParquetDataCatalog.from_uri(self.uri)
        self.output = Path(temp.name) / "snapshot"

    def prepare(self, data, horizon, end_minute, **kwargs):
        end = START + pd.Timedelta(minutes=end_minute)
        return prepare(self.uri, START.isoformat(), end.isoformat(), horizon, data, self.output, **kwargs)

    def snapshot(self):
        features = pd.read_parquet(self.output / "features.parquet")
        labels = pd.read_parquet(self.output / "labels.parquet")
        pd.testing.assert_frame_equal(features[["ts", "instrument"]], labels[["ts", "instrument"]])
        return features.assign(target=labels.target)

    def test_query_passes_identifiers_and_predicate_to_nautilus_and_excludes_end(self):
        bars = [bar(series, minute, value) for series in (MID, LAST)
                for minute, value in [(0, 100), (5, 105), (10, 110)]]
        self.catalog.write_data(bars)
        selectors = {"identifiers": [MID], "where": f"ts_init > {START.value}"}
        native = self.catalog.query(Bar, start=START.value, end=START.value + 10 * MINUTE - 1, **selectors)
        self.assertEqual(len(native), 1)
        coverage = self.prepare({"data_cls": "nautilus_trader.model.data:Bar", **selectors}, 5, 10)
        result = self.snapshot()
        self.assertEqual(coverage["rows"], len(native))
        self.assertEqual(result.ts.tolist(), [native[0].ts_init])
        self.assertEqual(result.close.tolist(), [float(native[0].close)])
        self.assertTrue(result.target.isna().all())

    def test_default_read_keeps_overlapping_bar_types_and_labels_the_same_series(self):
        self.catalog.write_data([bar(MID, 0, 100), bar(MID, 5, 110), bar(LAST, 0, 200), bar(LAST, 5, 160)])
        coverage = self.prepare(None, 5, 10)
        result = self.snapshot()
        self.assertEqual((coverage["rows"], coverage["instruments"], coverage["observedTimestamps"]), (4, 1, 2))
        self.assertIn("bar_type", coverage["columns"])
        first = result[result.ts == START.value].set_index("bar_type")
        self.assertAlmostEqual(first.loc[MID, "target"], 0.10)
        self.assertAlmostEqual(first.loc[LAST, "target"], -0.20)
        self.assertTrue(result[result.ts == START.value + 5 * MINUTE].target.isna().all())

    def test_legacy_bar_spec_resumes_its_original_selection_schema_and_labels(self):
        external = f"{ASSET}-1-MINUTE-LAST-EXTERNAL"
        internal = f"{ASSET}-1-MINUTE-LAST-INTERNAL"
        self.catalog.write_data([bar(external, minute, 100 + minute) for minute in (0, 1, 2, 4, 5)]
                                + [bar(internal, 3, 1000), bar(MID, 0, 2000)])
        self.prepare("1-MINUTE-LAST", 2, 6)
        result = self.snapshot()
        self.assertEqual(list(result), ["ts", "instrument", "open", "high", "low", "close", "volume", "target"])
        self.assertEqual(result.close.tolist(), [100, 101, 102, 104, 105])
        self.assertAlmostEqual(result.target.iloc[0], 0.02)
        self.assertTrue(result.target.iloc[1:].isna().all())

    def test_trade_tick_query_preserves_native_fields_and_simultaneous_trades(self):
        self.catalog.write_data([tick(ASSET, 0, 100, "a"), tick(ASSET, 0, 125, "b"),
                                 tick(ASSET, 1, 150, "c"), tick(ASSET, 2, 160, "d"),
                                 tick("ETH.SIM", 0, 300, "e")])
        data = {"data_cls": "nautilus_trader.model.data:TradeTick", "identifiers": [ASSET]}
        coverage = self.prepare(data, 1, 2)
        result = self.snapshot().set_index("trade_id")
        self.assertEqual(coverage["rows"], 3)
        self.assertEqual(set(result.index), {"a", "b", "c"})
        self.assertEqual(result.loc["a", "ts"], result.loc["b", "ts"])
        self.assertEqual(result.loc["a", "price"], 100)
        self.assertEqual(result.loc["c", "size"], 2)
        self.assertAlmostEqual(result.loc["a", "target"], 0.5)
        self.assertAlmostEqual(result.loc["b", "target"], 0.2)
        self.assertTrue(np.isnan(result.loc["c", "target"]))

    def test_irregular_stream_uses_the_last_update_by_the_horizon_and_requires_followup(self):
        self.catalog.write_data([tick(ASSET, 0, 100, "first"), tick(ASSET, 4, 110, "before"),
                                 tick(ASSET, 6, 130, "after")])
        self.prepare({"data_cls": "nautilus_trader.model.data:TradeTick"}, 5, 10)
        result = self.snapshot().set_index("trade_id")
        self.assertAlmostEqual(result.loc["first", "target"], 0.1)
        self.assertTrue(result.loc[["before", "after"], "target"].isna().all())

    def test_quote_labels_use_the_observed_bid_and_ask(self):
        instrument = InstrumentId.from_str(ASSET)
        size = Quantity.from_int(3)
        self.catalog.write_data([
            QuoteTick(instrument, Price.from_str(bid), Price.from_str(ask), size, size, ts, ts)
            for ts, bid, ask in [(START.value, "99", "101"), (START.value + MINUTE, "106", "114")]
        ])
        self.prepare({"data_cls": "nautilus_trader.model.data:QuoteTick"}, 1, 2)
        result = self.snapshot()
        self.assertEqual(result.bid_price.tolist(), [99, 106])
        self.assertEqual(result.ask_price.tolist(), [101, 114])
        self.assertAlmostEqual(result.target.iloc[0], 0.10)

    def test_catalog_registered_custom_data_can_supply_its_own_target_field(self):
        observations = [
            ResearchObservation(instrument_id=InstrumentId.from_str(ASSET), reference=reference,
                                venue_note="published", ts_event=ts - 1, ts_init=ts)
            for ts, reference in [(START.value, -80.0), (START.value + MINUTE, -84.0),
                                  (START.value + 2 * MINUTE, 0.0), (START.value + 3 * MINUTE, 1.0)]
        ]
        observations.append(ResearchObservation(instrument_id=InstrumentId.from_str(ASSET), reference=500.0,
                                                venue_note="draft", ts_event=START.value + 3 * MINUTE,
                                                ts_init=START.value + 3 * MINUTE))
        self.catalog.write_data(observations)
        data = {"data_cls": ResearchObservation.fully_qualified_name(), "identifiers": [ASSET],
                "files": self.catalog.get_file_list_from_data_cls(ResearchObservation),
                "filter_expr": 'field("venue_note") == "published"'}
        coverage = self.prepare(data, 1, 4, target_field="reference")
        result = self.snapshot()
        self.assertEqual(coverage["rows"], 4)
        self.assertEqual(result.venue_note.tolist(), ["published"] * 4)
        self.assertEqual(result.reference.tolist(), [-80.0, -84.0, 0.0, 1.0])
        self.assertAlmostEqual(result.target.iloc[0], 0.05)
        self.assertAlmostEqual(result.target.iloc[1], -1.0)
        self.assertTrue(result.target.iloc[2:].isna().all())

    def test_custom_series_field_groups_returns_without_rewriting_catalog_data(self):
        readings = []
        for minute, amounts in enumerate([(40.0, 10.0), (44.0, 8.0), (55.0, 12.0)]):
            ts = START.value + minute * MINUTE
            for series, amount in zip(("A", "B"), amounts, strict=True):
                readings.append(AuctionReading(ts_event=ts, ts_init=ts, series_id=series, amount=amount))
        self.catalog.write_data(readings)
        coverage = self.prepare({"data_cls": AuctionReading.fully_qualified_name()}, 1, 3,
                                target_field="amount", instrument_field="series_id")
        result = self.snapshot()
        self.assertEqual((coverage["rows"], coverage["instruments"], coverage["labelRows"]), (6, 2, 4))
        self.assertEqual(result.instrument.tolist(), result.series_id.tolist())
        for series, expected in [("A", [0.10, 0.25]), ("B", [-0.20, 0.50])]:
            targets = result[result.series_id == series].target
            np.testing.assert_allclose(targets.iloc[:2], expected)
            self.assertTrue(np.isnan(targets.iloc[2]))

    def test_unpriced_noninstrument_events_remain_available_to_factors(self):
        self.catalog.write_data([ResearchHeadline(ts_event=START.value, ts_init=START.value, headline="reported")])
        coverage = self.prepare({"data_cls": ResearchHeadline.fully_qualified_name()}, 5, 10)
        result = self.snapshot()
        self.assertEqual(result.headline.tolist(), ["reported"])
        self.assertTrue(result.instrument.isna().all())
        self.assertTrue(result.target.isna().all())
        self.assertEqual(coverage["labelRows"], 0)

    def test_empty_native_result_has_zero_coverage(self):
        self.catalog.write_data([bar(MID, 0, 100)])
        coverage = self.prepare({"data_cls": "nautilus_trader.model.data:Bar", "identifiers": [LAST]}, 5, 10)
        self.assertEqual((coverage["rows"], coverage["instruments"], coverage["observedTimestamps"]), (0, 0, 0))
        self.assertIsNone(coverage["from"])
        self.assertIsNone(coverage["through"])
        self.assertTrue(self.snapshot().empty)

    def test_invalid_native_predicate_reaches_the_caller(self):
        self.catalog.write_data([bar(MID, 0, 100)])
        selector = {"where": "unknown_catalog_field = 1"}
        with self.assertRaisesRegex(RuntimeError, "unknown_catalog_field") as native:
            self.catalog.query(Bar, **selector)
        with self.assertRaises(type(native.exception)) as observed:
            self.prepare({"data_cls": "nautilus_trader.model.data:Bar", **selector}, 5, 10)
        self.assertEqual(str(observed.exception), str(native.exception))

    def test_factor_reader_preserves_empty_and_mixed_native_account_metadata(self):
        states = []
        for offset, info in enumerate([{}, {"tag": ["ok", 7]}]):
            event = AccountState.to_dict(TestEventStubs.cash_account_state())
            ts = START.value + offset * MINUTE
            states.append(AccountState.from_dict({**event, "info": info, "ts_event": ts, "ts_init": ts}))
        self.catalog.write_data(states)
        coverage = self.prepare({"data_cls": "nautilus_trader.model.events.account:AccountState"}, 1, 2)
        self.assertEqual(coverage["rows"], 2)
        candidate = self.output / "candidate.py"
        candidate.write_text('''def factor(df):
    def check(info):
        if info == {}:
            return 0
        assert info == {"tag": ["ok", 7]}
        return 1
    return df["info"].map(check)
''', encoding="utf8")
        reader = Path(__file__).resolve().parents[1] / "quant" / "factor.py"
        worker = subprocess.run([sys.executable, reader, candidate, self.output / "features.parquet"],
                                text=True, capture_output=True)
        self.assertEqual(worker.returncode, 0, worker.stderr)
        self.assertEqual(json.loads(worker.stdout), [0.0, 1.0])
