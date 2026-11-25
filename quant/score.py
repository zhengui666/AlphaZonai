"""Deterministic cross-sectional predictive statistics, not a simulator."""
import numpy as np

def evaluate(frame, max_nan=0.3, min_assets=5, min_periods=5):
    absent = float(frame.factor.isna().mean())
    if not np.isfinite(absent) or absent > max_nan:
        return {"failure": "MISSING_VALUES", "coverage": {"missing": absent if np.isfinite(absent) else None}}
    eligible = frame.dropna(subset=["factor", "target"])
    ic, rank_ic, mi = [], [], []
    for _, group in eligible.groupby("ts", sort=False):
        x, y = group.factor, group.target
        if len(group) < min_assets or x.nunique() < 3 or y.nunique() < 2:
            continue
        rx, ry = x.rank(method="average"), y.rank(method="average")
        ic.append(float(x.corr(y)))
        rank_ic.append(float(rx.corr(ry)))
        # Equal-frequency rank bins per timestamp, with at least 16 assets for 4 bins.
        if len(group) >= 16:
            bins = min(8, int(np.sqrt(len(group))))
            ix = ((rx-1)*bins/len(group)).astype(int)
            iy = ((ry-1)*bins/len(group)).astype(int)
            hist = np.zeros((bins, bins))
            np.add.at(hist, (ix.to_numpy(), iy.to_numpy()), 1)
            p = hist / len(group)
            indep = p.sum(axis=1)[:, None] * p.sum(axis=0)[None, :]
            mask = p > 0
            raw = (p[mask] * np.log(p[mask] / indep[mask])).sum()
            dof = ((hist.sum(axis=1)>0).sum()-1)*((hist.sum(axis=0)>0).sum()-1)
            mi.append(float(max(0, raw-dof/(2*len(group)))))
    if len(ic)<min_periods or len(mi)<min_periods:
        return {"failure":"INSUFFICIENT_CROSS_SECTIONS","coverage":{"periods":len(ic),"miPeriods":len(mi),"missing":absent}}
    def ir(xs):
        sd = np.std(xs, ddof=1)
        return float(np.mean(xs)/sd) if sd > 1e-12 else None
    scores = {"ic":float(np.mean(ic)), "rank_ic":float(np.mean(rank_ic)), "icir":ir(ic), "rank_icir":ir(rank_ic), "mi":float(np.mean(mi))}
    return {"scores": scores, "coverage":{"periods":len(ic),"miPeriods":len(mi),"missing":absent}}
