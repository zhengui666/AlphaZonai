"""Trusted entry point inside the candidate sandbox."""
import json
import sys
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

source, data = sys.argv[1:]
scope = {}
with open(source, encoding="utf8") as f:
    exec(compile(f.read(), "<factor>", "exec"), scope)
table = pq.read_table(data)
frame = table.to_pandas()
packed = json.loads((table.schema.metadata or {}).get(b"alphazonai.msgpack", b"[]"))
if packed:
    import msgspec
    for name in packed:
        frame[name] = frame[name].map(msgspec.msgpack.decode)
del table
frame = frame.set_index(["ts", "instrument"]).sort_index()
cutoffs = sorted(frame.index.get_level_values("ts").unique())
idx = sorted({int((len(cutoffs)-1)*x) for x in (.25, .5, .75)} - {len(cutoffs)-1})
factor = scope["factor"]

def run(df):
    with np.errstate(over="raise", invalid="raise", divide="raise", under="ignore"):
        output = factor(df.copy(deep=True))
    if not isinstance(output, pd.Series) or not output.index.equals(df.index):
        raise ValueError("OUTPUT_ALIGNMENT")
    output = output.astype(float).to_numpy()
    if np.isinf(output).any():
        raise ValueError("NON_FINITE")
    return output

base = run(frame)
ts = frame.index.get_level_values("ts")
for i in idx:
    keep = ts <= cutoffs[i]
    if not np.allclose(base[keep], run(frame[keep]), rtol=1e-8, atol=1e-10, equal_nan=True):
        raise ValueError("LOOKAHEAD")
    changed = frame.copy()
    future = ~keep
    for name, values in frame.items():
        later = values[future]
        # Scale continuous values. Permute actual future values for identifiers,
        # integer timestamps and nested native fields without changing the dtype.
        perturbed = later * 1.11 if pd.api.types.is_float_dtype(values) else later.iloc[::-1]
        changed.loc[future, name] = perturbed.array
    if not np.allclose(base[keep], run(changed)[keep], rtol=1e-8, atol=1e-10, equal_nan=True):
        raise ValueError("LOOKAHEAD")
print(json.dumps([float(x) if np.isfinite(x) else None for x in base], allow_nan=False))
