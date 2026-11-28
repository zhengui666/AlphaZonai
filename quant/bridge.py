"""Catalog adapter and trusted coordinator; never imports candidate code."""
import argparse
import ast
from contextlib import redirect_stdout
from decimal import Decimal
import json
import os
from pathlib import Path
import posixpath
import re
import subprocess
import sys
import tempfile

import numpy as np
import pandas as pd
from score import evaluate

HERE = Path(__file__).resolve().parent
RUNTIME = Path(sys.prefix).resolve()
if RUNTIME == Path("/usr"):
    RUNTIME = Path("/usr")

def make_labels(frame, horizon):
    """Reproduce the contiguous minute labels of previously saved barSpec runs."""
    by_asset = frame.groupby("instrument", sort=False)
    future_close = by_asset.close.shift(-horizon)
    future_ts = by_asset.ts.shift(-horizon, fill_value=0)
    target = future_close.div(frame.close).sub(1)
    available = (future_ts - frame.ts == horizon * 60_000_000_000) & (frame.close > 0)
    return pd.DataFrame({"ts": frame.ts, "instrument": frame.instrument,
                         "target": target.where(available & np.isfinite(target))})

def _run_factor(script, features, timeout):
    # Bind the Python environment and two input files only. No ambient environment,
    # Catalog directory, labels, host home, sockets, or network are available.
    cmd=["bwrap","--unshare-all","--die-with-parent","--new-session","--clearenv",
         "--ro-bind","/usr","/usr","--ro-bind-try","/lib","/lib","--ro-bind-try","/lib64","/lib64",
         "--dev","/dev","--tmpfs","/tmp","--dir","/work",
         "--ro-bind",str(HERE/"factor.py"),"/work/factor.py",
         "--ro-bind",str(script),"/work/source.py",
         "--ro-bind",str(features),"/work/features.parquet",
         # The image installs CPython's shared library in this read-only path.
         # The isolated root does not include the host's ld.so.cache.
         "--setenv","LD_LIBRARY_PATH","/usr/local/lib",
         "--setenv","OPENBLAS_NUM_THREADS","1","--setenv","OMP_NUM_THREADS","1"]
    if not str(RUNTIME).startswith("/usr/") and RUNTIME != Path("/usr"):
        cmd += ["--ro-bind",str(RUNTIME),str(RUNTIME)]
    cmd += ["--chdir","/work",sys.executable,"-I","/work/factor.py","/work/source.py","/work/features.parquet"]
    return subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,env={"PATH":os.defpath})


def sandbox_available():
    # Probe the actual isolated entry point before any provider calls.
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "probe.py"
            features = root / "features.parquet"
            script.write_text("def factor(df):\n    return df.close\n", encoding="utf8")
            pd.DataFrame({"ts":[0], "instrument":["probe"], "close":[1.0]}).to_parquet(
                features, index=False)
            result = _run_factor(script, features, timeout=15)
            if result.returncode:
                diagnostic = result.stderr.decode(errors="replace").strip()[-800:]
                print(f"Trusted factor sandbox probe failed: {diagnostic}", file=sys.stderr)
                return False
            return json.loads(result.stdout) == [1.0]
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return False


def catalog_class(name):
    from nautilus_trader.core.nautilus_pyo3 import convert_to_snake_case
    from nautilus_trader.persistence.funcs import filename_to_class
    from nautilus_trader.serialization.arrow.serializer import RUST_SERIALIZERS, list_schemas

    # Resolve only types registered in the operator's Nautilus runtime. A request
    # must never import a module or execute a constructor of its choosing.
    module, _, short_name = name.rpartition(":")
    if not module:
        by_filename = filename_to_class(short_name)
        if by_filename is not None:
            return by_filename
    snake = convert_to_snake_case(short_name)
    for cls in (filename_to_class(snake), filename_to_class("custom_" + snake),
                *list_schemas(), *RUST_SERIALIZERS):
        if cls and short_name == cls.__qualname__ and (not module or module == cls.__module__):
            return cls
    raise LookupError(f"No Nautilus catalog data class registered for {name!r}")


def catalog_files(catalog, files):
    # Explicit native file selectors are scoped to the operator's catalog just
    # like a discovered file. On local filesystems resolve symlinks as well.
    if not isinstance(files, list):
        raise TypeError("files must be a list of catalog paths")
    paths = []
    for file in files:
        path = catalog.fs._strip_protocol(file) if "://" in file else file
        if catalog.fs_protocol == "file":
            root = Path(catalog.path).resolve()
            selected = (root / path).resolve()
            contained = selected.is_relative_to(root)
        else:
            root = posixpath.normpath(catalog.path)
            selected = posixpath.normpath(path)
            if not selected.startswith(root.rstrip("/") + "/") and "://" not in file:
                selected = posixpath.normpath(posixpath.join(root, selected))
            contained = posixpath.commonpath([root, selected]) == root
        if not contained:
            raise ValueError("Requested file is outside the configured Nautilus catalog")
        paths.append(str(selected))
    return paths


def feature_frame(observations, instrument_field):
    from nautilus_trader.model.data import CustomData
    from nautilus_trader.model.identifiers import Identifier, InstrumentId
    from nautilus_trader.model.objects import Price, Quantity
    from nautilus_trader.serialization.arrow.serializer import ArrowSerializer

    rows, timestamps, instruments = [], [], []
    for observation in observations:
        record = observation.data if isinstance(observation, CustomData) else observation
        cls = type(record)
        if hasattr(cls, "to_dict"):
            row = cls.to_dict(record)
        else:
            row = ArrowSerializer.serialize_batch([record], cls).to_pylist()[0]
        # Nautilus serializes prices and quantities as strings. Convert their native
        # typed attributes for arithmetic while keeping identifiers and text intact.
        for key, value in row.items():
            attr = getattr(record, key, None)
            if isinstance(attr, (Price, Quantity, Decimal)):
                row[key] = float(attr)
            elif isinstance(value, Decimal):
                row[key] = float(value)
            elif isinstance(value, Identifier):
                row[key] = str(value)
        instrument = getattr(record, "instrument_id", None)
        if instrument is None:
            instrument = getattr(getattr(record, "bar_type", None), "instrument_id", None)
        if instrument is None and isinstance(getattr(record, "id", None), InstrumentId):
            instrument = record.id
        if instrument is None and isinstance(getattr(record, "instrument", None), InstrumentId):
            instrument = record.instrument
        rows.append(row)
        timestamps.append(record.ts_init)
        instruments.append(str(instrument) if instrument is not None else None)

    frame = pd.DataFrame.from_records(rows)
    aliases = {}
    for key in ("ts", "instrument"):
        if key in frame:
            alias = "native." + key
            while alias in frame:
                alias = "native." + alias
            frame.rename(columns={key:alias}, inplace=True)
            aliases[key] = alias

    source = aliases.get(instrument_field, instrument_field)
    if instrument_field is not None:
        def series_key(value):
            if not pd.api.types.is_scalar(value) or pd.isna(value):
                return None
            if isinstance(value, (float, np.floating)) and not np.isfinite(value):
                return None
            return str(value) or None

        instruments = frame[source].map(series_key) if source in frame else None
    frame["ts"] = timestamps
    frame["instrument"] = instruments
    return frame.sort_values(["ts", "instrument"], kind="stable", ignore_index=True), aliases


def write_features(frame, path):
    import msgspec
    import pyarrow as pa
    import pyarrow.parquet as pq
    from nautilus_trader.common.config import msgspec_encoding_hook

    # An opaque native metadata field can contain e.g. {} or heterogeneous
    # nested values which have no Parquet type. Preserve only such columns as
    # MessagePack and restore them when the evaluator opens the snapshot.
    arrow_errors = (pa.ArrowInvalid, pa.ArrowTypeError, pa.ArrowNotImplementedError)
    try:
        frame.to_parquet(path, index=False)
        return
    except arrow_errors:
        encoded = []
        for name, column in frame.items():
            if not pd.api.types.is_object_dtype(column.dtype):
                continue
            try:
                schema = pa.Schema.from_pandas(frame[[name]], preserve_index=False)
                with pq.ParquetWriter(pa.BufferOutputStream(), schema):
                    pass
            except arrow_errors:
                frame[name] = frame[name].map(lambda value: msgspec.msgpack.encode(value, enc_hook=msgspec_encoding_hook))
                encoded.append(name)
        if not encoded:
            raise
    table = pa.Table.from_pandas(frame, preserve_index=False)
    metadata = {**table.schema.metadata, b"alphazonai.msgpack":json.dumps(encoded).encode()}
    pq.write_table(table.replace_schema_metadata(metadata), path)


def return_labels(frame, horizon, target_field, bar_streams):
    labels = frame[["ts", "instrument"]].copy()
    labels["target"] = np.nan
    if target_field is None or frame.empty:
        return labels
    prices = pd.to_numeric(frame[target_field], errors="coerce").to_numpy(dtype=float, na_value=np.nan)
    timestamps = frame.ts.to_numpy()
    # A query may select several bar streams of one instrument. Their prices
    # define distinct time series even if availability timestamps coincide.
    keys = ["instrument", "bar_type"] if bar_streams else ["instrument"]
    horizon_ns = horizon * 60_000_000_000
    for indices in frame.groupby(keys, sort=False).indices.values():
        times = timestamps[indices]
        if horizon_ns > int(times[-1]) - int(times[0]):
            continue
        current = indices[times <= int(times[-1]) - horizon_ns]
        origins = timestamps[current]
        # Last observed price by the horizon, with actual subsequent data and
        # follow-through to that horizon. Never synthesize a minute grid.
        positions = times.searchsorted(origins + horizon_ns, side="right") - 1
        future = indices[positions]
        base = prices[current]
        later = prices[future]
        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            returns = later / base - 1
        eligible = (times[positions] > origins) & np.isfinite(base) & (base != 0) & np.isfinite(returns)
        labels.loc[current[eligible], "target"] = returns[eligible]
    return labels


def prepare(catalog_path, start, end, horizon, data, out, target_field=None, instrument_field=None):
    from nautilus_trader.core.datetime import time_object_to_dt
    from nautilus_trader.model.data import Bar, QuoteTick
    from nautilus_trader.model.enums import AggregationSource
    from nautilus_trader.persistence.catalog import ParquetDataCatalog
    from nautilus_trader.persistence.funcs import parse_filters_expr

    catalog = ParquetDataCatalog.from_uri(str(catalog_path))
    legacy_bar_spec = data if isinstance(data, str) else None
    query = {} if legacy_bar_spec else dict(data or {})
    data_cls = catalog_class(query.pop("data_cls", "Bar"))
    def timestamp(value):
        # JSON clients carry full-precision Unix nanoseconds as decimal text.
        if isinstance(value, str) and re.fullmatch(r"[+-]?\d{16,}", value):
            value = int(value)
        return time_object_to_dt(value)

    lo, hi = timestamp(start), timestamp(end) - pd.Timedelta(1, unit="ns")
    if lo > hi:
        raise ValueError("Research end must be later than start")
    if query.get("start") is not None:
        lo = max(lo, timestamp(query["start"]))
    if query.get("end") is not None:
        hi = min(hi, timestamp(query["end"]))
    query.update(start=lo, end=hi)
    if query.get("filter_expr") is not None:
        query["filter_expr"] = parse_filters_expr(query["filter_expr"])
    if query.get("files") is not None:
        query["files"] = catalog_files(catalog, query["files"])
    if query.get("where"):
        # Preserve precedence of predicates containing OR with native time bounds.
        query["where"] = f"({query['where']})"
    records = catalog.query(data_cls=data_cls, **query)
    if legacy_bar_spec:
        # A durable task created before native queries had a different selection
        # and fixed feature schema. Resume it with its recorded contract.
        records = [bar for bar in records if str(bar.bar_type.spec) == legacy_bar_spec
                   and bar.bar_type.aggregation_source == AggregationSource.EXTERNAL]
    frame, aliases = feature_frame(records, instrument_field)
    del records
    if legacy_bar_spec:
        frame = frame.reindex(columns=["ts","instrument","open","high","low","close","volume"])
    if issubclass(data_cls, QuoteTick) and not frame.empty and "mid" not in frame:
        frame["mid"] = (frame.bid_price + frame.ask_price) / 2
    target_field = aliases.get(target_field, target_field)
    if target_field is None:
        target_field = next((field for field in ("close", "price", "mid", "close_price") if field in frame), None)
        if target_field is None and data_cls.__name__ in ("MarkPriceUpdate", "IndexPriceUpdate"):
            target_field = "value"
    if target_field not in frame or frame.empty:
        target_field = None
    elif pd.api.types.is_string_dtype(frame[target_field].dtype) and target_field != "instrument":
        values = pd.to_numeric(frame[target_field], errors="coerce")
        if values.notna().equals(frame[target_field].notna()):
            frame[target_field] = values
    if legacy_bar_spec:
        labels = make_labels(frame, horizon)
    else:
        labels = return_labels(frame, horizon, target_field, issubclass(data_cls, Bar))
    ts = pd.to_datetime(frame.ts, unit="ns", utc=True)
    out.mkdir(parents=True,exist_ok=True)
    for name,df in [("features",frame),("labels",labels)]:
        tmp = out / (name + ".tmp")
        if name == "features":
            write_features(df, tmp)
        else:
            df.to_parquet(tmp,index=False)
        tmp.replace(out / (name + ".parquet"))
    # The subsequent holdout must begin after both the requested window and
    # the latest availability timestamp actually used by the evaluator.
    last_ns = max(hi.value, int(frame.ts.max())) if len(frame) else hi.value
    return {"rows":len(frame), "instruments":frame.instrument.nunique(),
            "from":str(ts.min()) if len(ts) else None, "through":str(ts.max()) if len(ts) else None,
            "observedTimestamps":ts.nunique(), "columns":frame.columns.drop(["ts","instrument"]).tolist(),
            "targetField":target_field, "instrumentField":instrument_field,
            "labelRows":int(labels.target.count()), "endExclusiveNs":str(last_ns + 1)}

def score(data, source, max_nan):
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {"failure":"FACTOR_INPUT"}
    if not any(isinstance(n, ast.FunctionDef) and n.name=="factor" for n in tree.body):
        return {"failure":"FACTOR_ENTRY"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in {"bfill","backfill"}:
                return {"failure":"LOOKAHEAD"}
            if node.func.attr in {"shift","diff","pct_change"} and any(isinstance(a,ast.UnaryOp) and isinstance(a.op,ast.USub) for a in [*node.args,*[k.value for k in node.keywords if k.arg=="periods"]]):
                return {"failure":"LOOKAHEAD"}
    with tempfile.TemporaryDirectory(dir=data) as td:
        script=Path(td) / "source.py"
        script.write_text(source,encoding="utf8")
        p = _run_factor(script, data / "features.parquet", timeout=120)
        if p.returncode:
            log=p.stderr.decode(errors="replace")
            if "bwrap:" in log:
                raise RuntimeError("SANDBOX_UNAVAILABLE")
            for code in ("LOOKAHEAD","OUTPUT_ALIGNMENT","NON_FINITE"):
                if code in log: return {"failure":code}
            return {"failure":"FACTOR_RUNTIME"}
        values=json.loads(p.stdout)
    # The isolated entry point returns values in its sorted (ts, instrument)
    # index order, not physical parquet row order. Align labels to that order.
    frame=(pd.read_parquet(data/"labels.parquet").set_index(["ts","instrument"])
           .sort_index().reset_index())
    if not isinstance(values,list) or len(values)!=len(frame):
        return {"failure":"OUTPUT_ALIGNMENT"}
    frame["factor"]=pd.to_numeric(pd.Series(values),errors="coerce")
    return evaluate(frame,max_nan=max_nan)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("operation",choices=["prepare","score"])
    p.add_argument("path",type=lambda x:Path(x).resolve())
    args=p.parse_args()
    cfg=json.load(sys.stdin)
    if args.operation=="prepare":
        try:
            with redirect_stdout(sys.stderr):
                result=prepare(cfg["catalog"],cfg["start"],cfg["end"],cfg["horizon"],
                               cfg.get("data", cfg.get("barSpec")),args.path,cfg.get("targetField"),cfg.get("instrumentField"))
        except BaseException as exc:
            # PyO3 exposes Rust panics as a BaseException in a synthetic module.
            # Propagate cancellation and interpreter exits normally.
            if not isinstance(exc, Exception) and (type(exc).__module__, type(exc).__name__) != ("pyo3_runtime", "PanicException"):
                raise
            message = f"{type(exc).__name__}: {exc}"
            message = re.sub(r"(\w[\w+.-]*://)[^/\s]*@", r"\1[redacted]@", message)
            message = re.sub(r"(\w[\w+.-]*://[^?#\s]*)[?#][^\s]*", r"\1?[redacted]", message)
            print(json.dumps({"error":message[:1000]}))
            sys.exit(1)
        if result["labelRows"] and not sandbox_available():
            raise RuntimeError("SANDBOX_UNAVAILABLE")
    else:
        result=score(args.path,cfg["code"],cfg["nanLimit"])
    print(json.dumps(result, allow_nan=False))
