"""Read-only performance snapshots for an existing NautilusTrader node."""
import asyncio
import json
import logging
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from itertools import chain, groupby
from math import isfinite
from uuid import uuid4
from zoneinfo import ZoneInfo

import pandas as pd
from nautilus_trader.analysis.reporter import ReportProvider
from nautilus_trader.core.datetime import unix_nanos_to_dt
from nautilus_trader.model.enums import OrderSide
from nautilus_trader.model.identifiers import AccountId, StrategyId


def timestamp(ns):
    return unix_nanos_to_dt(ns).isoformat(timespec="nanoseconds")


def currency_summary(currency, closed, fees, first_open):
    closed.sort()
    amounts = [amount for _, amount in closed]
    gains = sum(amount for amount in amounts if amount > 0)
    losses = -sum(amount for amount in amounts if amount < 0)
    pnl = peak = drawdown = Decimal(0)
    curve = []
    if closed and first_open < closed[0][0]:
        curve.append({"time": timestamp(first_open), "pnl": "0"})
    # Simultaneous closes are one portfolio observation, regardless of cache order.
    for time, same_time in groupby(closed, key=lambda item: item[0]):
        pnl += sum(amount for _, amount in same_time)
        peak = max(peak, pnl)
        drawdown = max(drawdown, peak - pnl)
        curve.append({"time": timestamp(time), "pnl": str(pnl)})
    return {
        "currency": currency, "realizedPnl": str(pnl), "maxDrawdown": str(drawdown),
        "closedCount": len(closed), "winRate": sum(x > 0 for x in amounts) / len(amounts) if amounts else None,
        "profitFactor": float(gains / losses) if losses else None, "fees": str(fees), "curve": curve,
    }


def performance_report(node, *, mode: str, account_id: str, strategy_id: str, parameters: dict | None = None,
                       coverage_start: datetime | None = None) -> dict:
    """Call on the host node's thread while its native cache is available."""
    if mode not in ("paper", "live"):
        raise ValueError("mode must be paper or live")
    if parameters is not None and (not isinstance(parameters, dict) or any(
        not isinstance(k, str) or not k or type(v) not in (str, bool, int, float)
        or (isinstance(v, float) and not isfinite(v)) for k, v in parameters.items()
    )):
        raise ValueError("parameters must map names to text, finite numbers or booleans")
    account_key, strategy_key = AccountId(account_id), StrategyId(strategy_id)
    captured_at = datetime.now(timezone.utc)
    if coverage_start is not None and (coverage_start.tzinfo is None or coverage_start > captured_at):
        raise ValueError("coverage_start must be timezone-aware and at or before capture")
    since = pd.Timestamp(coverage_start).value if coverage_start is not None else None
    cache = node.cache
    account = cache.account(account_key)
    if account is None:
        raise ValueError(f"Account {account_id} is absent from this node's cache")
    scope = {"account_id": account_key, "strategy_id": strategy_key}

    fills = []
    fees = defaultdict(Decimal)
    orders = cache.orders(**scope)
    if since is not None:
        # A late earlier-dated event can move a native order's ts_last backwards.
        orders = [o for o in orders if o.filled_qty > 0 and (
            o.ts_last >= since or any(event.ts_event >= since for event in o.events)
        )]
    fill_report = ReportProvider.generate_fills_report(orders)
    for fill in fill_report.itertuples():
        if fill.account_id != account_id or fill.strategy_id != strategy_id:
            continue
        if since is not None and fill.ts_event.value < since:
            continue
        commission = None if pd.isna(fill.commission) else fill.commission
        if commission is not None:
            amount, currency = commission.rsplit(" ", 1)
            fees[currency] += Decimal(amount)
        fills.append({
            "time": fill.ts_event.isoformat(timespec="nanoseconds"), "tradeId": fill.trade_id,
            "orderId": fill.Index, "positionId": None if pd.isna(fill.position_id) else fill.position_id,
            "instrument": fill.instrument_id,
            "side": fill.order_side, "quantity": fill.last_qty, "price": fill.last_px,
            "currency": fill.currency, "commission": commission, "liquidity": fill.liquidity_side,
        })
    fills.sort(key=lambda fill: (fill["time"], fill["instrument"], fill["tradeId"], fill["orderId"]))

    positions = []
    closed = defaultdict(list)
    first_open = {}
    current = ((p, False) for p in cache.positions(**scope))
    snapshots = ((p, True) for p in cache.position_snapshots(account_id=account_key) if p.ts_closed)
    included_trades = {(f["instrument"], f["tradeId"]) for f in fills} if since is not None else None
    seen = set()
    for position, snapshot in chain(current, snapshots):
        if position.strategy_id != strategy_key or position.account_id != account_key or not position.ts_opened:
            continue
        if since is not None and position.ts_closed and position.ts_closed < since:
            continue
        position_id = str(position.id)
        # v1.231 appends "-<uuid>" to a NETTING snapshot's original ID.
        cycle = (position_id[:-37] if snapshot else position_id, position.ts_opened, str(position.opening_order_id))
        if cycle in seen:
            continue
        seen.add(cycle)
        currency = str(position.settlement_currency)
        start = max(since or 0, position.ts_opened)
        first_open[currency] = min(first_open.get(currency, start), start)
        realized = position.realized_pnl
        if position.ts_closed and realized is not None:
            closed[currency].append((position.ts_closed, realized.as_decimal()))
        instrument = str(position.instrument_id)
        trade_ids = position.trade_ids
        positions.append({
            "id": position_id, "instrument": instrument,
            "side": "LONG" if position.entry == OrderSide.BUY else "SHORT",
            "opened": timestamp(position.ts_opened), "closed": timestamp(position.ts_closed) if position.ts_closed else None,
            "quantity": str(position.quantity), "peakQuantity": str(position.peak_qty),
            "realizedPnl": str(realized) if realized is not None else None,
            "tradeIds": [tid for tid in map(str, trade_ids) if included_trades is None or (instrument, tid) in included_trades],
            **({"openingTradeId": str(trade_ids[0])} if since is not None and trade_ids else {}),
        })
    positions.sort(key=lambda position: (position["opened"], position["id"]))
    balances = []
    for balance in account.balances().values():
        row = balance.to_dict()
        balances.append({key: row[key] for key in ("currency", "total", "free", "locked")})
    return {
        "id": str(uuid4()), "sessionId": str(node.instance_id), "mode": mode,
        "accountId": account_id, "strategyId": strategy_id, "asOf": captured_at.isoformat(),
        **({"coverageStart": timestamp(since)} if since is not None else {}),
        **({"parameters": dict(parameters)} if parameters else {}),
        "currencies": [currency_summary(c, closed[c], fees[c], first_open.get(c)) for c in sorted(first_open.keys() | fees.keys())],
        "balances": sorted(balances, key=lambda b: b["currency"]), "fills": fills, "positions": positions,
    }


def _next_capture(as_of):
    captured = datetime.fromisoformat(as_of).astimezone(ZoneInfo("Asia/Shanghai"))
    boundary = captured.replace(hour=0, minute=5, second=0, microsecond=0)
    return boundary if boundary > captured else boundary + timedelta(days=1)


def _import_report(report):
    result = subprocess.run(
        ["alphazonai", "performance", "import", "--report-file", "-"],
        input=json.dumps(report, allow_nan=False), text=True, capture_output=True, timeout=60,
    )
    if result.returncode:
        try:
            error = json.loads(result.stderr).get("error", {})
        except (json.JSONDecodeError, AttributeError):
            error = {}
        if error.get("httpStatus") == 413:
            logging.getLogger(__name__).error("Snapshot %s exceeds the upload limit; next capture will run on schedule", report["id"])
            return
        raise RuntimeError(result.stderr.strip() or f"alphazonai exited with status {result.returncode}")


async def publish_daily_performance(node, *, mode: str, account_id: str, strategy_id: str, parameters=None):
    """Publish one snapshot on attachment and at 00:05 Asia/Shanghai on the node's event loop."""
    pending = None
    while True:
        try:
            if pending is None:
                previous_day = datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(days=1)
                pending = performance_report(
                    node, mode=mode, account_id=account_id, strategy_id=strategy_id,
                    parameters=parameters() if callable(parameters) else parameters,
                    coverage_start=previous_day.replace(hour=0, minute=0, second=0, microsecond=0),
                )
            # Native cache access stays on the node thread. Encoding and HTTP run outside it.
            await asyncio.to_thread(_import_report, pending)
        except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
            logging.getLogger(__name__).warning("Performance publish for %s/%s will retry: %s", account_id, strategy_id, error)
            await asyncio.sleep(300)
            continue
        due = _next_capture(pending["asOf"])
        pending = None
        await asyncio.sleep(max(0, (due - datetime.now(timezone.utc)).total_seconds()))
