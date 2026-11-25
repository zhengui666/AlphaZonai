"""Run inside the built image without network, market data, or credentials."""
from pathlib import Path
from tempfile import TemporaryDirectory
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "quant"))
from bridge import sandbox_available, score

assert sandbox_available(), "The deployed image cannot open the candidate sandbox"
random = np.random.default_rng(31)
with TemporaryDirectory() as tmp:
    state = Path(tmp)
    rows = []
    for t in range(12):
        for i in range(40):
            rows.append((t, str(i), float(i + 1), float(i) + random.normal(0, 1 + t)))
    data = pd.DataFrame(rows, columns=["ts", "instrument", "close", "target"])
    data.drop(columns="target").to_parquet(state / "features.parquet", index=False)
    data.drop(columns="close").to_parquet(state / "labels.parquet", index=False)
    source = """def factor(df):
    from pathlib import Path
    import os
    assert not Path("/app").exists()
    assert not Path("/catalog").exists()
    assert not Path("/state").exists()
    assert "OPENAI_API_KEY" not in os.environ
    return df.close / 2
"""
    result = score(state, source, 0.3)
    assert result["scores"]["ic"] > 0.8, result
    rejection = score(state, "def factor(df):\n    return df.close * df.close.mean()\n", 0.3)
    assert rejection.get("failure") == "LOOKAHEAD", rejection
print("Built-image isolated factor execution and leakage rejection passed")
