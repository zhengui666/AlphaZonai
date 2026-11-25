"""Catalog adapter and trusted coordinator; never imports candidate code."""
import argparse
import ast
import json
import os
from pathlib import Path
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


def prepare(catalog_path, start, end, horizon, bar_spec, out):
    from nautilus_trader.persistence.catalog import ParquetDataCatalog
    catalog = ParquetDataCatalog(catalog_path)
    lo, hi = pd.Timestamp(start), pd.Timestamp(end)
    rows = []
    for left in pd.date_range(lo.normalize(), hi, inclusive="left"):
        a, b = max(lo, left), min(hi, left + pd.Timedelta(days=1))
        if a>=b:
            continue
        for bar in catalog.bars(start=a.value, end=b.value-1):
            if str(bar.bar_type.spec) != bar_spec or str(bar.bar_type.aggregation_source).split(".")[-1] not in ("EXTERNAL", "1"):
                continue
            rows.append((bar.ts_init, str(bar.bar_type.instrument_id), *map(float, (bar.open,bar.high,bar.low,bar.close,bar.volume))))
    frame = pd.DataFrame(rows, columns=["ts","instrument","open","high","low","close","volume"])
    if frame.empty:
        raise ValueError("NO_BARS")
    frame = frame.sort_values(["ts","instrument"],ignore_index=True)
    if frame.duplicated(["ts","instrument"]).any():
        raise ValueError("DUPLICATE_BARS")
    ts = pd.to_datetime(frame.ts,utc=True)
    labels = make_labels(frame, horizon)
    out.mkdir(parents=True,exist_ok=True)
    for name,df in [("features",frame),("labels",labels)]:
        tmp = out / (name + ".tmp")
        df.to_parquet(tmp,index=False)
        tmp.replace(out / (name + ".parquet"))
    return {"rows":len(frame),"instruments":frame.instrument.nunique(),"from":str(ts.min()),"through":str(ts.max()),"observedMinutes":ts.nunique(),"expectedMinutes":int((hi-lo)/pd.Timedelta(minutes=1))}

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
    frame=pd.read_parquet(data/"labels.parquet")
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
        if not sandbox_available():
            raise RuntimeError("SANDBOX_UNAVAILABLE")
        result=prepare(cfg["catalog"],cfg["start"],cfg["end"],cfg["horizon"],cfg["barSpec"],args.path)
    else:
        result=score(args.path,cfg["code"],cfg["nanLimit"])
    print(json.dumps(result, allow_nan=False))
