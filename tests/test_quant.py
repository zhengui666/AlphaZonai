from pathlib import Path
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"quant"))
from bridge import make_labels
from score import evaluate

class Metrics(unittest.TestCase):
    def test_factor_scoring(self):
        rnd=np.random.default_rng(31)
        out=[]
        for t in range(12):
            for i in range(40):
                out.append((t,i,float(i),float(i)+rnd.normal(0,1+t)))
        sample=pd.DataFrame(out,columns=["ts","instrument","factor","target"])
        r=evaluate(sample)
        self.assertGreater(r["scores"]["ic"],0.8)
        self.assertGreater(r["scores"]["rank_ic"],0.8)
        self.assertGreater(r["scores"]["mi"],0)
        self.assertEqual(r["coverage"]["periods"],12)
        sample.loc[sample.index[:200],"factor"]=None
        self.assertEqual(evaluate(sample)["failure"],"MISSING_VALUES")

    def test_future_label_cannot_bridge_a_gap_or_cross_instrument(self):
        m=60_000_000_000
        frame=pd.DataFrame([(0,"A",100),(0,"B",100),(m,"B",101),(2*m,"A",102),(2*m,"B",103)],columns=["ts","instrument","close"])
        got=make_labels(frame,2).target
        self.assertTrue(np.isnan(got[0]))
        self.assertAlmostEqual(got[1],0.03)

    def test_degenerate_sections_are_not_scores(self):
        frame=pd.DataFrame({"ts":[0]*5,"factor":[1]*5,"target":[1,2,3,4,5]})
        self.assertEqual(evaluate(frame)["failure"],"INSUFFICIENT_CROSS_SECTIONS")

class CandidateRunner(unittest.TestCase):
    def test_trusted_causal_and_noncausal_source(self):
        import subprocess
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)
            frame=pd.DataFrame([(t,a,float(20+t)) for t in range(8) for a in ("A","B")],
                               columns=["ts","instrument","close"])
            frame.to_parquet(path/"bars.parquet",index=False)
            caller=[sys.executable,str(Path(__file__).resolve().parents[1]/"quant"/"factor.py"),
                    str(path/"candidate.py"),str(path/"bars.parquet")]
            (path/"candidate.py").write_text("def factor(df):\n    return df.close / 2\n")
            result=subprocess.run(caller,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            (path/"candidate.py").write_text("def factor(df):\n    return df.groupby(level='instrument').close.shift(-1)\n")
            result=subprocess.run(caller,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn("LOOKAHEAD",result.stderr)
