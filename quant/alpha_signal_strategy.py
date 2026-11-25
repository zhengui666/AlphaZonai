"""Trusted Nautilus runtime for AlphaZonai's declarative, versioned strategy plans."""
from collections import deque
from math import isfinite, tanh

from nautilus_trader.config import StrategyConfig
from nautilus_trader.model.data import BarType
from nautilus_trader.model.enums import OrderSide, TimeInForce
from nautilus_trader.model.objects import Quantity
from nautilus_trader.trading.strategy import Strategy


FORMULAS = {"return", "relative_volume", "range", "close_location"}


def number(value, low, high):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not isfinite(value) or not low <= value <= high:
        raise ValueError("Invalid strategy number")
    return value


def clean_plan(raw):
    if not isinstance(raw, dict) or set(raw) != {"title", "signals", "entry", "exit", "stop_loss", "allocation", "max_positions"}:
        raise ValueError("Invalid strategy plan fields")
    if not isinstance(raw["title"], str) or not 1 <= len(raw["title"].strip()) <= 96:
        raise ValueError("Invalid strategy title")
    if not isinstance(raw["signals"], list) or not 1 <= len(raw["signals"]) <= 8:
        raise ValueError("Invalid signal count")
    signals, names = [], set()
    for s in raw["signals"]:
        if not isinstance(s, dict) or set(s) != {"kind", "lookback", "scale", "weight"} or s["kind"] not in FORMULAS:
            raise ValueError("Invalid signal")
        n = number(s["lookback"], 1, 1440)
        if type(n) is not int or (s["kind"], n) in names:
            raise ValueError("Invalid or duplicate lookback")
        names.add((s["kind"], n))
        w = number(s["weight"], -1, 1)
        if not w:
            raise ValueError("Zero factor weight")
        signals.append({"kind": s["kind"], "lookback": n, "scale": number(s["scale"], 0.001, 1e4), "weight": w})
    threshold = number(raw["entry"], 0.01, 0.99)
    exit_at = number(raw["exit"], -0.99, 0.98)
    if exit_at >= threshold:
        raise ValueError("Exit must be below entry")
    positions = number(raw["max_positions"], 1, 1000)
    if type(positions) is not int:
        raise ValueError("Invalid position limit")
    return {"title": raw["title"].strip(), "signals": signals, "entry": threshold, "exit": exit_at,
            "stop_loss": number(raw["stop_loss"], 0.001, 0.5),
            "allocation": number(raw["allocation"], 0.01, 1), "max_positions": positions}


def signal_score(rows, terms):
    current = rows[-1]
    result = 0
    for term in terms:
        n = term["lookback"]
        window = rows[-n-1:-1]
        kind = term["kind"]
        if kind == "return":
            val = current[2] / window[0][2] - 1
        elif kind == "relative_volume":
            mean = sum(r[3] for r in window) / n
            val = current[3] / mean - 1 if mean > 0 else 0
        elif kind == "range":
            val = sum((r[0] - r[1]) / r[2] for r in rows[-n:]) / n
        else:
            val = sum((2 * (r[2] - r[1]) / (r[0] - r[1]) - 1) if r[0] > r[1] else 0 for r in rows[-n:]) / n
        result += term["weight"] * tanh(term["scale"] * val)
    return result / sum(abs(t["weight"]) for t in terms)


class AlphaSignalConfig(StrategyConfig, frozen=True):
    plan: dict
    quantities: dict[str, str]


class AlphaSignalStrategy(Strategy):
    """Long or flat. Uses only consecutive, closed, external minute bars."""
    def __init__(self, config: AlphaSignalConfig):
        super().__init__(config)
        self.plan = clean_plan(config.plan)
        self._window_size = max(s["lookback"] for s in self.plan["signals"]) + 1
        self._types = [BarType.from_str(b) for b in sorted(config.quantities)]
        if not self._types or len({b.instrument_id for b in self._types}) != len(self._types):
            raise ValueError("Configure one bar stream per instrument")
        self._buffers = {str(b): deque(maxlen=self._window_size) for b in self._types}
        self._last = {}
        self._pending = {}

    def on_start(self):
        for bar_type in self._types:
            if self.cache.instrument(bar_type.instrument_id) is None:
                raise ValueError(f"Missing instrument {bar_type.instrument_id}")
            self.subscribe_bars(bar_type)

    def on_bar(self, bar):
        key = str(bar.bar_type)
        iid = bar.bar_type.instrument_id
        rows = self._buffers.get(key)
        if rows is None:
            return
        ts = int(bar.ts_event)
        last = self._last.get(key)
        if last is not None and ts <= last:
            return
        if last is not None and ts - last != 60_000_000_000:
            rows.clear()
        self._last[key] = ts
        high, low, close, volume = map(float, (bar.high, bar.low, bar.close, bar.volume))
        if close <= 0 or not all(map(isfinite, (high, low, close, volume))):
            rows.clear()
            return
        rows.append((high, low, close, volume))

        pending = self._pending.get(iid)
        if pending is not None:
            order = self.cache.order(pending)
            if order is None or not order.is_closed:
                return
            del self._pending[iid]

        positions = self.cache.positions_open(strategy_id=self.id)
        owned = [p for p in positions if p.instrument_id == iid and p.is_long]
        current = signal_score(list(rows), self.plan["signals"]) if len(rows) >= self._window_size else None
        if owned:
            for position in owned:
                breached = close <= float(position.avg_px_open) * (1 - self.plan["stop_loss"])
                if not (breached or current is not None and current <= self.plan["exit"]):
                    continue
                order = self.order_factory.market(iid, OrderSide.SELL, position.quantity, time_in_force=TimeInForce.IOC,
                                                  reduce_only=True)
                self._pending[iid] = order.client_order_id
                self.submit_order(order, position_id=position.id)
                return
        if owned or not self.portfolio.is_flat(iid) or current is None or current < self.plan["entry"]:
            return
        # Count pending opens to avoid simultaneously exceeding the portfolio position limit.
        if len({p.instrument_id for p in positions} | set(self._pending)) >= self.plan["max_positions"]:
            return
        instrument = self.cache.instrument(iid)
        max_qty = Quantity.from_str(self.config.quantities[key])
        inc = instrument.size_increment.as_decimal()
        from decimal import Decimal
        units = (max_qty.as_decimal() * Decimal(str(self.plan["allocation"]))) // inc
        qty = instrument.make_qty(units * inc)
        if float(qty) <= 0:
            return
        order = self.order_factory.market(iid, OrderSide.BUY, qty, time_in_force=TimeInForce.IOC)
        self._pending[iid] = order.client_order_id
        self.submit_order(order)

    def on_stop(self):
        # Stopping the strategy never opens or closes positions by itself.
        pass
