"""
step_analysis.py
CSU-TAPS sprinkler corn competition, 2023 to 2025: analysis in the format of the UF STEP presentation.
Reads only STEP_analysis_input.xlsx (sheets Farm_year and Futures). Data organized by Wub Yilma.

Figures (same order as the STEP slides)
  S11 hybrid selection and yield        S16 % yield increase per N step
  S12 seeding rate and yield            S17 ETa and yield (linear by season)
  S13 irrigation and yield (quadratic)  S18 WNIPI vs cost of production and profitability
  S14 % yield increase per irrigation   S19 December corn futures price
  S15 nitrogen and yield (quadratic)    S20 correlation heat map   S21 PCA biplot by year
Results workbook: fitted equations, correlations, % increase tables, PCA loadings.

Usage:  python step_analysis.py                (US units, output folder STEP_out_US)
        python step_analysis.py SI             (kg/ha, mm; output folder STEP_out_SI)
"""
import os, sys, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Ellipse, Rectangle
from matplotlib.colors import LinearSegmentedColormap

UNITS = sys.argv[1].upper() if len(sys.argv) > 1 else "US"
IN = "STEP_analysis_input.xlsx"
OUT = f"STEP_out_{UNITS}"; os.makedirs(OUT, exist_ok=True)
plt.rcParams.update({"font.size": 10, "savefig.dpi": 300, "savefig.bbox": "tight"})

YRS = [2023, 2024, 2025]
COL = {2023: "#4CC24C", 2024: "#1F3FD1", 2025: "#D49A2B"}     # green, blue, orange (STEP colors)
MK = {2023: "^", 2024: "s", 2025: "D"}
REF = "#2E9E2E"                                                  # green dashed reference lines (means)

# ------------------------------------------------------------------ data and units
F = pd.read_excel(IN, sheet_name="Farm_year")
FU = pd.read_excel(IN, sheet_name="Futures"); FU["Date"] = pd.to_datetime(FU.Date)
if UNITS == "SI":   # bu/ac -> kg/ha (56 lb/bu), in -> mm, lb/ac -> kg/ha, per ac -> per ha, $/bu -> $/kg, $/ac -> $/ha
    k = dict(Y=62.77, L=25.4, N=1.12085, A=2.47105, C=1 / 25.401, PA=2.47105, PR=39.368)
    LAB = dict(Y="Yield (kg ha$^{-1}$)", I="Cumulative Irrigation (mm)", N="Cumulative Nitrogen Application (kg N ha$^{-1}$)",
               S="Seeding Rate (seeds ha$^{-1}$)", ET="ETa (mm)", C="Cost of production ($/kg)", PR="Profitability ($/ha)",
               PRICE="$/t", unit_I="mm", unit_N="kg N ha$^{-1}$", step_I=25.0, step_N=25.0)
else:
    k = dict(Y=1, L=1, N=1, A=1, C=1, PA=1, PR=1)
    LAB = dict(Y="Yield (bu ac$^{-1}$)", I="Cumulative Irrigation (in)", N="Cumulative Nitrogen Application (lb N ac$^{-1}$)",
               S="Seeding Rate (seeds ac$^{-1}$)", ET="ETa (in)", C="Cost of production ($/bu)", PR="Profitability ($/ac)",
               PRICE="$/bu", unit_I="in", unit_N="lb N ac$^{-1}$", step_I=1.0, step_N=20.0)
D = pd.DataFrame({"Year": F.Year, "Hybrid": F.Hybrid, "Yield": F.Yield_bu_ac * k["Y"], "I": F.Irrigation_in * k["L"],
                  "N": F.N_lb_ac * k["N"], "SR": F.Seed_per_ac * k["A"], "ET": F.ETa_in * k["L"], "P": F.Rain_in * k["L"],
                  "WNIPI": F.WNIPI, "Cost": F.Cost_per_bu * k["C"], "Profit": F.Profit_per_ac * k["PA"]})
T = {}                                                           # result tables


def fit(x, y, deg):
    c = np.polyfit(x, y, deg); yhat = np.polyval(c, x)
    return c, 1 - np.sum((y - yhat) ** 2) / np.sum((y - np.mean(y)) ** 2)


def eqtext(c, r2, yr):
    sg = lambda v: ("+ " if v >= 0 else "- ") + f"{abs(v):.4g}"
    if len(c) == 3: return f"y$_{{{yr}}}$ = {c[0]:.4g}x$^2$ {sg(c[1])}x {sg(c[2])}\nR$^2$ = {r2:.2f}"
    return f"y$_{{{yr}}}$ = {c[0]:.4g}x {sg(c[1])}\nR$^2$ = {r2:.2f}"


def points(ax, x, y, loc="upper left"):
    for yr in YRS:
        d = D[D.Year == yr]; ax.scatter(d[x], d[y], marker=MK[yr], color=COL[yr], s=24, label=str(yr), zorder=3)
    ax.legend(loc=loc, ncol=3, frameon=False, handletextpad=0.1)


def means(ax, x, y):
    ax.axhline(D[y].mean(), color=REF, ls="--", lw=1); ax.axvline(D[x].mean(), color=REF, ls="--", lw=1)


# ------------------------------------------------------------------ S11 hybrid selection and yield
hy = sorted(D.Hybrid.unique(), reverse=True); pos = {h: i for i, h in enumerate(hy)}
top = D.Hybrid.value_counts().idxmax()
fig, axs = plt.subplots(1, 4, figsize=(10, 5.2), gridspec_kw={"width_ratios": [1, 1, 1, 1.2], "wspace": 0.06})
for j, yr in enumerate(YRS):
    ax = axs[j]; d = D[D.Year == yr]
    ax.scatter(d.Yield, d.Hybrid.map(pos), color=COL[yr], s=24, zorder=3)
    ax.set_facecolor("#EBEBEB"); ax.grid(color="white"); ax.set_axisbelow(True); ax.set_title(str(yr), backgroundcolor="#D9D9D9")
    ax.set_yticks(range(len(hy))); ax.set_yticklabels(hy if j == 0 else [], fontsize=8); ax.set_ylim(-0.7, len(hy) - 0.3)
    ax.set_xlim(D.Yield.min() * 0.92, D.Yield.max() * 1.05)
    ax.add_patch(Rectangle((ax.get_xlim()[0], pos[top] - 0.5), np.diff(ax.get_xlim())[0], 1, fill=False, ec="#C0392B", lw=1.4, clip_on=False))
axs[0].set_ylabel("Hybrid"); axs[1].set_xlabel("Yield")
m = D.groupby("Year").Yield.mean(); axs[3].axis("off")
axs[3].table(cellText=[[str(y), f"{m[y]:.0f}"] for y in YRS], colLabels=["Year", "Yield"], bbox=[0.05, 0.6, 0.9, 0.35], edges="horizontal")
for i, yr in enumerate(YRS): axs[3].scatter([0.1], [0.45 - i * 0.07], color=COL[yr], s=24); axs[3].text(0.18, 0.45 - i * 0.07, str(yr), va="center")
axs[3].set_xlim(0, 1); axs[3].set_ylim(0, 1)
fig.savefig(f"{OUT}/S11_hybrid_selection_yield.png"); plt.close(fig)
T["Hybrid_top"] = D[D.Hybrid == top].groupby("Year").Yield.agg(["count", "min", "max"]).assign(Hybrid=top)

# ------------------------------------------------------------------ S12 seeding rate and yield
fig, ax = plt.subplots(figsize=(8, 4.2)); points(ax, "SR", "Yield"); means(ax, "SR", "Yield")
ax.set_xlabel(LAB["S"]); ax.set_ylabel(LAB["Y"]); ax.set_ylim(0, D.Yield.max() * 1.12)
fig.savefig(f"{OUT}/S12_seeding_rate_yield.png"); plt.close(fig)


# ------------------------------------------------------------------ S13 to S16 quadratic response and % increase
def response(x, xl, name, step, pctlab):
    rows = []
    fig, ax = plt.subplots(figsize=(8, 4.2)); points(ax, x, "Yield"); means(ax, x, "Yield")
    for i, yr in enumerate(YRS):
        d = D[D.Year == yr]; c, r2 = fit(d[x].values, d.Yield.values, 2)
        xs = np.linspace(0, D[x].max() * 1.05, 100); ax.plot(xs, np.polyval(c, xs), ":", color=COL[yr], lw=1.3)
        ax.text(0.99, 0.86 - 0.15 * i, eqtext(c, r2, yr), transform=ax.transAxes, ha="right", va="top", fontsize=8.5)
        xopt = -c[1] / (2 * c[0]) if c[0] < 0 else np.nan
        rows.append({"Year": yr, "a": c[0], "b": c[1], "c": c[2], "R2": r2, "x_at_max_yield": xopt})
    ax.set_xlim(0, D[x].max() * 1.5); ax.set_ylim(0, D.Yield.max() * 1.15); ax.set_xlabel(xl); ax.set_ylabel(LAB["Y"])
    fig.savefig(f"{OUT}/{name}_yield.png"); plt.close(fig)
    fits = pd.DataFrame(rows); T[f"{name}_fits"] = fits
    # percent increase in fitted yield for each added step
    xs = np.arange(step, D[x].max() * 1.3 + step, step); pr = []
    fig, ax = plt.subplots(figsize=(8, 4.2))
    for _, r in fits.iterrows():
        c = [r.a, r.b, r.c]; base = np.polyval(c, xs - step); ok = base > 0.3 * D.Yield.max()   # skip near-zero fitted yields
        v = 100 * (np.polyval(c, xs) - base) / base
        ax.scatter(xs[ok], v[ok], s=9, color=COL[int(r.Year)], label=str(int(r.Year)), zorder=3)
        pr += [{"Year": int(r.Year), "x": a, "pct_increase": b} for a, b in zip(xs[ok], v[ok])]
    pr = pd.DataFrame(pr); T[f"{name}_pct"] = pr
    lo, hi = min(-10, pr.pct_increase.min() * 1.3), pr.pct_increase.max() * 1.25
    opt = fits.x_at_max_yield[(fits.x_at_max_yield > D[x].min()) & (fits.x_at_max_yield < D[x].max())]
    if len(opt): ax.add_patch(Rectangle((opt.min() - step / 2, lo * 0.97), opt.max() - opt.min() + step, (hi - lo) * 0.95, fill=False, ec="#C0392B", lw=1.6))
    ax.axhline(0, color="k", ls="--", lw=0.8); ax.set_ylim(lo, hi); ax.set_xlim(0, xs.max() + step)
    ax.legend(loc="upper left", ncol=3, frameon=False); ax.set_xlabel(pctlab); ax.set_ylabel("% Increase in Yield")
    fig.savefig(f"{OUT}/{name}_pct_increase.png"); plt.close(fig)


response("I", LAB["I"], "S13_S14_irrigation", LAB["step_I"], f"Irrigation Application ({LAB['unit_I']})")
response("N", LAB["N"], "S15_S16_nitrogen", LAB["step_N"], f"Nitrogen Application ({LAB['unit_N']})")

# ------------------------------------------------------------------ S17 ETa and yield
fig, ax = plt.subplots(figsize=(8, 4.4)); rows = []
for i, yr in enumerate(YRS):
    d = D[D.Year == yr]; ax.scatter(d.ET, d.Yield, marker=MK[yr], color=COL[yr], s=34, label=str(yr), zorder=3)
    c, r2 = fit(d.ET.values, d.Yield.values, 1); x0 = -c[1] / c[0]
    xs = np.linspace(max(x0, 0), D.ET.max() * 1.05, 50); ax.plot(xs, np.polyval(c, xs), ":", color=COL[yr], lw=1.3)
    ax.text(0.06 + (i % 2) * 0.24, 0.97 - (i // 2) * 0.13, eqtext(c, r2, yr), transform=ax.transAxes, va="top", fontsize=8.5)
    rows.append({"Year": yr, "slope": c[0], "intercept": c[1], "R2": r2, "ET_at_zero_yield": x0})
T["S17_ET_fits"] = pd.DataFrame(rows)
ax.axhline(D.Yield.mean(), color=REF, ls="--", lw=1); ax.legend(loc="lower right", edgecolor="k")
x0m = T["S17_ET_fits"].ET_at_zero_yield.clip(lower=0).mean()
ax.annotate("", xy=(x0m, D.Yield.max() * 0.02), xytext=(0.1, D.Yield.max() * 0.02),
            arrowprops=dict(arrowstyle="<->", color="#2E7D32", connectionstyle="arc3,rad=-0.9", lw=1.3))
ax.text(0.2, D.Yield.max() * 0.36, "| ET Needed to produce any yield |", fontsize=9)
ax.set_xlim(0, D.ET.max() * 1.15); ax.set_ylim(0, D.Yield.max() * 1.12); ax.set_xlabel(LAB["ET"]); ax.set_ylabel(LAB["Y"])
fig.savefig(f"{OUT}/S17_ET_yield.png"); plt.close(fig)

# ------------------------------------------------------------------ S18 efficiency (WNIPI) vs cost and profitability
fig, axs = plt.subplots(1, 2, figsize=(11, 4.2), gridspec_kw={"wspace": 0.28}); rows = []
for ax, y, yl in [(axs[0], "Cost", LAB["C"]), (axs[1], "Profit", LAB["PR"])]:
    points(ax, "WNIPI", y, loc="lower left")
    for i, yr in enumerate(YRS):
        d = D[D.Year == yr]; c, r2 = fit(d.WNIPI.values, d[y].values, 1)
        xs = np.linspace(d.WNIPI.min(), d.WNIPI.max(), 20); ax.plot(xs, np.polyval(c, xs), ":", color=COL[yr], lw=1.3)
        ax.text(0.97, 0.98 - 0.12 * i, eqtext(c, r2, yr), transform=ax.transAxes, ha="right", va="top", fontsize=8.5)
        rows.append({"y": y, "Year": yr, "slope": c[0], "intercept": c[1], "R2": r2})
    lo, hi = ax.get_ylim(); ax.set_ylim(lo - 0.15 * (hi - lo), hi + 0.45 * (hi - lo)); ax.set_ylabel(yl)
axs[0].set_xlabel("Efficiency(WNIPI)"); axs[1].set_xlabel("WNIPI"); axs[1].axhline(0, color="k", ls="--", lw=0.8)
fig.savefig(f"{OUT}/S18_WNIPI_cost_profit.png"); plt.close(fig); T["S18_WNIPI_fits"] = pd.DataFrame(rows)

# ------------------------------------------------------------------ S19 December corn futures
fig, ax = plt.subplots(figsize=(8.5, 4.4))
for yr in YRS:
    d = FU[FU.Year == yr]; ax.plot(pd.to_datetime("2000-" + d.Date.dt.strftime("%m-%d")), d.Close_per_bu * k["PR"], color=COL[yr], lw=1.4, label=str(yr))
ax.xaxis.set_major_locator(mdates.MonthLocator()); ax.xaxis.set_major_formatter(mdates.DateFormatter("%b"))
ax.set_ylabel(LAB["PRICE"]); ax.text(0.03, 0.95, "December Corn Futures, 2023-2025", transform=ax.transAxes, va="top")
ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=3, frameon=False)
fig.savefig(f"{OUT}/S19_futures_price.png"); plt.close(fig)
T["S19_price_summary"] = FU.groupby("Year").agg(start=("Date", "min"), end=("Date", "max"), min=("Close_per_bu", "min"), max=("Close_per_bu", "max"))

# ------------------------------------------------------------------ S20 correlation heat map
order = ["P", "Profit", "ET", "I", "Yield", "N", "SR", "WNIPI"]
C = D[order].corr(); M = C.loc[order[::-1], order]
cmap = LinearSegmentedColormap.from_list("step", ["#F5E61A", "#F4A04A", "#E86BC4", "#B04FE0", "#6A36E6", "#2A2AD8"])
fig, ax = plt.subplots(figsize=(6.4, 6)); im = ax.imshow(M.values, cmap=cmap, vmin=-1, vmax=1)
for i in range(8):
    for j in range(8): ax.text(j, i, f"{M.iloc[i, j]:.2f}", ha="center", va="center", color="white", fontsize=9)
ax.set_xticks(range(8)); ax.set_xticklabels(order, rotation=45); ax.set_yticks(range(8)); ax.set_yticklabels(M.index)
ax.set_title("Correlation Matrix of Agronomic and Economic Variables"); fig.colorbar(im, ax=ax, fraction=0.04, pad=0.08, label="r")
fig.savefig(f"{OUT}/S20_correlation_heatmap.png"); plt.close(fig); T["S20_correlation"] = C
T["S20_within_season_r"] = pd.concat({yr: D[D.Year == yr][order].corr()[["Yield"]] for yr in YRS}, axis=1)

# ------------------------------------------------------------------ S21 PCA biplot by year
V = {"Profit": "Profit", "Yield": "Yield", "ET": "ET", "I": "Irrigation", "N": "NInput", "SR": "Plant.Population", "P": "P", "WNIPI": "WNIPI"}
Z = D[list(V)].rename(columns=V); Zs = (Z - Z.mean()) / Z.std(ddof=0)
_, S, Vt = np.linalg.svd(Zs.values, full_matrices=False); ev = S ** 2 / (len(Zs) - 1); var = 100 * ev / ev.sum()
sc = Zs.values @ Vt.T[:, :2]; load = Vt.T[:, :2] * np.sqrt(ev[:2])
if load[1, 0] < 0: sc[:, 0] *= -1; load[:, 0] *= -1            # orient Yield to the right
if load[0, 1] < 0: sc[:, 1] *= -1; load[:, 1] *= -1            # orient Profit up
fig, ax = plt.subplots(figsize=(6.4, 5.6))
for yr, mk in zip(YRS, ["^", "s", "+"]):
    s2 = sc[(D.Year == yr).values]; vals, vv = np.linalg.eigh(np.cov(s2.T)); ang = np.degrees(np.arctan2(vv[1, 1], vv[0, 1]))
    ax.add_patch(Ellipse(s2.mean(0), 2 * np.sqrt(5.991 * vals[1]), 2 * np.sqrt(5.991 * vals[0]), angle=ang, fc=COL[yr], alpha=0.18, ec=COL[yr]))
    ax.scatter(s2[:, 0], s2[:, 1], marker=mk, color=COL[yr], s=22, label=str(yr)); ax.scatter(*s2.mean(0), marker=mk, color=COL[yr], s=110)
for i, lab in enumerate(Z.columns):
    ax.annotate("", xy=load[i] * 2.6, xytext=(0, 0), arrowprops=dict(arrowstyle="->", color="#333333")); ax.text(*(load[i] * 2.8), lab, fontsize=8.5)
ax.axhline(0, color="k", ls="--", lw=0.7); ax.axvline(0, color="k", ls="--", lw=0.7)
ax.set_xlabel(f"Dim1 ({var[0]:.1f}%)"); ax.set_ylabel(f"Dim2 ({var[1]:.1f}%)"); ax.set_title("PCA Spatial Biplot by Year")
ax.legend(title="Col.", frameon=False); lim = max(np.abs(sc).max(), 3) * 1.15; ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim)
fig.savefig(f"{OUT}/S21_PCA_biplot.png"); plt.close(fig)
T["S21_PCA_loadings"] = pd.DataFrame(load, index=Z.columns, columns=[f"Dim1 ({var[0]:.1f}%)", f"Dim2 ({var[1]:.1f}%)"])

# ------------------------------------------------------------------ results workbook
with pd.ExcelWriter(f"{OUT}/STEP_results_{UNITS}.xlsx") as w:
    pd.DataFrame({"Item": ["Units", "Input", "Organized by"], "Value": [UNITS, IN, "Data organized by Wub Yilma"]}).to_excel(w, sheet_name="ReadMe", index=False)
    D.to_excel(w, sheet_name="Data_used", index=False)
    for name, t in T.items(): t.to_excel(w, sheet_name=name[:31])
print("done:", OUT)
