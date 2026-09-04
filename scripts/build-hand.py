"""
Height Above Nearest Drainage for the Majuli area of interest, calibrated
against the observed flood composite.

INPUT   Copernicus GLO-30 tiles cached by build-terrain.py ($SCRATCH/dem_*.tif)
        flood_frequency_1999_2000_2004.tif        observed extent, ground truth
OUTPUT  public/terrain-assam/hand.png             class x 80, as landslide.png
        public/terrain-assam/manifest.json        layer entry appended
        public/hand-assam/{z}/{x}/{y}.png         map overlay, z7..z12

WHY HAND RATHER THAN ELEVATION
------------------------------
Absolute elevation says nothing about flooding on a floodplain: a cell 80 m
above sea level beside the Brahmaputra floods, and one 80 m above sea level on
a terrace two kilometres inland does not. What separates them is height above
the nearest drainage the cell actually drains to, which is what HAND measures.
On this AOI mean slope is 0.5 degrees, so gradient discriminates nothing and
HAND is doing the work the slope layer does in the Ghats.

WHY THE COMPOSITE IS BOTH INPUT AND CHECK
-----------------------------------------
The observed composite is sparse and coarse: 3 sampled years at ~600 m, and
absence in it is not evidence of safety. HAND is dense, at the 100 m analysis
grid, and physically motivated -- but a HAND threshold chosen by eye is just a
guess with a hydrological accent. So the composite is used only to CALIBRATE
the threshold, and the resulting layer covers ground the composite never
sampled. The separation achieved is reported, honestly, below.

CAVEATS THAT TRAVEL WITH THE OUTPUT
-----------------------------------
  * Ground truth is ~600 m; the grid is 100 m. Each truth cell covers ~36
    analysis cells, so the labels are blocky and the achievable score is capped
    by that mismatch, not only by HAND's skill.
  * Three years is a short record. Cells labelled "not flooded" include ground
    that floods on a longer return period.
  * D8 routing on a braided river is a simplification: the Brahmaputra here
    splits into channels that a single-direction algorithm must pick between.
  * Flow accumulation is computed over a BUFFERED window so the AOI edges are
    not fed by truncated catchments, but drainage entering from outside the
    buffer is still unaccounted for.

Run: TERRAIN_AOI=majuli SCRATCH=<dir> python scripts/build-hand.py
"""
import json
import math
import os
import struct
import sys
import zlib

import numpy as np
import rasterio
from rasterio.windows import from_bounds

TRUTH = 'flood_frequency_1999_2000_2004.tif'
SCRATCH = os.environ.get('SCRATCH', '.')

# Must match build-terrain.py's majuli entry.
W, S, E, N = 93.85, 26.60, 94.75, 27.40
DEM_TILES = ['N26_00_E093', 'N26_00_E094', 'N27_00_E093', 'N27_00_E094']
OUT = 'public/terrain-assam'
CELL_M = 100.0

#: Degrees of padding for the hydrology only. Flow accumulation at a window
#: edge is fed by a truncated catchment, so the AOI is analysed inside a larger
#: window and cropped afterwards.
BUFFER_DEG = 0.15

#: Cells of upslope area before a cell counts as channel.
#:
#: NOT a textbook default. 500 cells (5 km^2) is the conventional starting
#: point and it is wrong here: it declared 3.6% of the window to be channel, so
#: nearly every cell sat within ~2 m of a "drainage" and HAND had no dynamic
#: range left to discriminate with (AUC 0.634). Swept against the observed
#: extent, discrimination peaks well above that and falls again beyond it:
#:
#:     ACC_CELLS     km2   channel%   median HAND   AUC
#:           500       5      3.60%        1.87 m   0.634
#:          5000      50      1.27%        3.93 m   0.666
#:         20000     200      0.63%        5.64 m   0.690
#:         50000     500      0.27%        8.00 m   0.723   <- used
#:        200000    2000      0.07%       11.01 m   0.693
#:
#: A braided river on a wide flat spreads accumulation, so the threshold that
#: recovers a channel network here is an order of magnitude above the usual.
ACC_CELLS = int(os.environ.get('HAND_ACC_CELLS', 50000))

#: Denser network used ONLY to fill cells the sparse one leaves undefined.
#:
#: compute_hand returns nodata where a cell's flow path never reaches the
#: channel mask, and at 50,000 cells that is 17.4% of this AOI. Those cells are
#: not upland and not safe -- their median elevation is 93.6 m against 91.3 m
#: for defined cells, and their observed flood fraction is HIGHER, 0.376
#: against 0.308. Letting them fall through to class 0 would have marked the
#: most flood-prone ground in the AOI as the safest, and scored AUC 0.626 over
#: the full grid. Filling them from a denser network recovers most of that:
#:
#:     fallback     coverage   filled    AUC over ALL cells
#:     none           82.6%       --     0.626   (undefined coded safe)
#:     acc>500        99.7%     17.1%    0.703
#:     acc>2000       99.4%     16.8%    0.710
#:     acc>5000       98.9%     16.3%    0.715   <- used
FALLBACK_ACC_CELLS = int(os.environ.get('HAND_FALLBACK_ACC_CELLS', 5000))

#: Cells where neither network resolves. NOT a class: a sentinel outside the
#: 0..3 x 80 ramp, so a consumer cannot mistake "not determined" for
#: "negligible". Roughly 1% of the AOI.
UNDETERMINED = 255

#: Same convention as landslide.png: small integer classes scaled to use the
#: 8-bit range legibly.
SCALE = 80
HAND_CLASS = {'High': 3, 'Moderate': 2, 'Low': 1, 'Negligible': 0}


def grid_shape(w, s, e, n):
    mid = math.radians((s + n) / 2)
    h = int(round((n - s) * 111320.0 / CELL_M))
    wd = int(round((e - w) * 111320.0 * math.cos(mid) / CELL_M))
    return h, wd


def dem_mosaic(w, s, e, n, lats, lons):
    """Copernicus tiles resampled onto the given lat/lon grid."""
    elev = np.full((lats.size, lons.size), np.nan, dtype='float32')
    for t in DEM_TILES:
        path = os.path.join(SCRATCH, f'dem_{t}.tif')
        if not os.path.exists(path):
            print(f'  missing {path} -- run build-terrain.py first')
            continue
        with rasterio.open(path) as src:
            b = src.bounds
            if b.right < w or b.left > e or b.top < s or b.bottom > n:
                continue
            win = from_bounds(max(w, b.left), max(s, b.bottom),
                              min(e, b.right), min(n, b.top), src.transform)
            data = src.read(1, window=win, masked=True)
            wt = src.window_transform(win)
            rows, cols = data.shape
            tlat = wt.f + (np.arange(rows) + 0.5) * wt.e
            tlon = wt.c + (np.arange(cols) + 0.5) * wt.a
            ri = np.clip(np.searchsorted(-tlat, -lats), 0, rows - 1)
            ci = np.clip(np.searchsorted(tlon, lons), 0, cols - 1)
            block = np.asarray(data.filled(np.nan))[np.ix_(ri, ci)]
            inside = ((lats[:, None] >= min(b.bottom, b.top))
                      & (lats[:, None] <= max(b.bottom, b.top))
                      & (lons[None, :] >= b.left) & (lons[None, :] <= b.right))
            elev = np.where(inside & np.isfinite(block), block, elev)
    return elev


def write_png_gray(path, arr):
    h, w = arr.shape
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return os.path.getsize(path)


def compute_hand(elev, west, north, dx, dy):
    """HAND over the buffered window, via pysheds."""
    from affine import Affine
    from pysheds.grid import Grid
    from pysheds.sview import Raster, ViewFinder

    # pysheds needs a real nodata rather than NaN for the integer-ish steps.
    nodata = -32768.0
    dem_arr = np.where(np.isfinite(elev), elev, nodata).astype('float64')

    vf = ViewFinder(affine=Affine(dx, 0.0, west, 0.0, -dy, north),
                    shape=dem_arr.shape, crs='epsg:4326', nodata=nodata)
    dem = Raster(dem_arr, viewfinder=vf)
    grid = Grid(viewfinder=vf)

    print('  conditioning DEM')
    filled = grid.fill_pits(dem)
    filled = grid.fill_depressions(filled)
    inflated = grid.resolve_flats(filled)

    print('  flow direction and accumulation')
    fdir = grid.flowdir(inflated)
    acc = grid.accumulation(fdir)

    def hand_for(threshold, label):
        ch = acc > threshold
        if not ch.any():
            raise RuntimeError(f'no channels at >{threshold} cells')
        print(f'  {label}: {int(ch.sum()):,} channel cells '
              f'({ch.mean() * 100:.2f}% of window) at >{threshold} upslope')
        return np.asarray(grid.compute_hand(fdir, inflated, ch), dtype='float32')

    primary = hand_for(ACC_CELLS, 'primary network')
    fallback = hand_for(FALLBACK_ACC_CELLS, 'fallback network')
    return primary, fallback


def truth_on_grid(lats, lons):
    """Observed flood extent resampled to the analysis grid.

    Reads `3 - value`, for the reasons established in
    scripts/probe-assam-raster.py: the stored value counts years NOT flooded,
    and the file's nodata=0 marks the most-flooded class, so it is ignored.
    """
    with rasterio.open(TRUTH) as d:
        a = d.read(1)
        tr = d.transform
    sh, sw = a.shape
    rows = np.clip(((lats - tr.f) / tr.e).astype(int), 0, sh - 1)
    cols = np.clip(((lons - tr.c) / tr.a).astype(int), 0, sw - 1)
    return 3 - np.clip(a[np.ix_(rows, cols)].astype('int16'), 0, 3)


def main():
    h, w = grid_shape(W, S, E, N)
    lats = np.linspace(N, S, h)
    lons = np.linspace(W, E, w)
    print(f'AOI {W},{S} -> {E},{N}   grid {w} x {h} at {CELL_M:.0f} m')

    bw, bs, be, bn = W - BUFFER_DEG, S - BUFFER_DEG, E + BUFFER_DEG, N + BUFFER_DEG
    bh, bwd = grid_shape(bw, bs, be, bn)
    blats = np.linspace(bn, bs, bh)
    blons = np.linspace(bw, be, bwd)
    print(f'hydrology window {bw:.2f},{bs:.2f} -> {be:.2f},{bn:.2f}  '
          f'grid {bwd} x {bh}\n')

    elev = dem_mosaic(bw, bs, be, bn, blats, blons)
    cover = np.isfinite(elev).mean()
    print(f'  DEM coverage {cover * 100:.1f}%  '
          f'{np.nanmin(elev):.0f}-{np.nanmax(elev):.0f} m')
    if cover < 0.99:
        print('  WARNING: incomplete DEM; HAND will be wrong near the gaps')

    prim_buf, fall_buf = compute_hand(elev, bw, bn,
                                      (be - bw) / bwd, (bn - bs) / bh)

    # Crop the buffered result back to the AOI grid by nearest lat/lon.
    ri = np.clip(np.searchsorted(-blats, -lats), 0, bh - 1)
    ci = np.clip(np.searchsorted(blons, lons), 0, bwd - 1)

    def crop(a):
        v = a[np.ix_(ri, ci)]
        return np.where(np.isfinite(v) & (v >= 0), v, np.nan)

    prim, fall = crop(prim_buf), crop(fall_buf)
    okp, okf = np.isfinite(prim), np.isfinite(fall)
    hand = np.where(okp, prim, np.where(okf, fall, np.nan))
    ok = np.isfinite(hand)
    filled = (~okp) & okf
    print(f'\n  HAND on AOI grid: primary {okp.mean() * 100:.1f}%, '
          f'+{filled.mean() * 100:.1f}% from fallback, '
          f'{(~ok).mean() * 100:.1f}% undetermined')
    print(f'    median {np.nanmedian(hand):.2f} m, '
          f'p95 {np.nanpercentile(hand, 95):.1f} m')

    # ---- calibration against observed extent
    freq = truth_on_grid(lats, lons)
    flooded = (freq >= 1) & ok
    dry = (freq == 0) & ok
    print(f'\ncalibration set: {int(flooded.sum()):,} flooded cells, '
          f'{int(dry.sum()):,} not-flooded ({flooded.sum() / ok.sum() * 100:.1f}% positive)')
    if flooded.sum() < 100:
        print('  too few positives to calibrate')
        return 1

    print(f'  HAND | flooded    median {np.median(hand[flooded]):6.2f} m  '
          f'p90 {np.percentile(hand[flooded], 90):6.2f} m')
    print(f'  HAND | not flooded median {np.median(hand[dry]):6.2f} m  '
          f'p10 {np.percentile(hand[dry], 10):6.2f} m')

    from sklearn.metrics import roc_auc_score, roc_curve
    y = np.concatenate([np.ones(int(flooded.sum())), np.zeros(int(dry.sum()))])
    # Low HAND means flood-prone, so the score is negated height.
    score = np.concatenate([-hand[flooded], -hand[dry]])
    auc = roc_auc_score(y, score)
    fpr, tpr, thr = roc_curve(y, score)
    j = np.argmax(tpr - fpr)
    T = -thr[j]
    print(f'\n  ROC AUC {auc:.3f}')
    print(f'  Youden-optimal threshold  HAND <= {T:.2f} m')
    print(f'    true positive rate {tpr[j] * 100:.1f}%  '
          f'false positive rate {fpr[j] * 100:.1f}%')

    # ---- empirical P(flooded | HAND), which sets the class breaks
    print('\n  observed flood fraction by HAND band:')
    edges = [0, 1, 2, 3, 5, 8, 12, 20, 1e9]
    for lo, hi in zip(edges, edges[1:]):
        m = ok & (hand >= lo) & (hand < hi)
        if m.sum() < 50:
            continue
        p = (freq[m] >= 1).mean()
        print(f'    {lo:>4.0f}-{hi if hi < 1e8 else float("inf"):>5.0f} m  '
              f'n={int(m.sum()):>7,}  P(flood)={p:.3f}')

    def frac(lo, hi):
        m = ok & (hand >= lo) & (hand < hi)
        return (freq[m] >= 1).mean() if m.sum() else 0.0

    # Class breaks are the HAND values at which observed frequency crosses
    # 0.5, 0.2 and 0.05. Derived, not chosen: the bands mean what the ground
    # truth says they mean.
    breaks = []
    for target in (0.5, 0.2, 0.05):
        lo, hi = 0.0, 60.0
        for _ in range(40):
            mid = (lo + hi) / 2
            m = ok & (hand >= mid - 0.5) & (hand < mid + 0.5)
            p = (freq[m] >= 1).mean() if m.sum() > 50 else 0.0
            if p >= target:
                lo = mid
            else:
                hi = mid
        breaks.append(round((lo + hi) / 2, 2))
    b_high, b_mod, b_low = breaks
    print(f'\n  class breaks from observed frequency:')
    print(f'    High       HAND <= {b_high:5.2f} m   (P >= 0.50)')
    print(f'    Moderate   HAND <= {b_mod:5.2f} m   (P >= 0.20)')
    print(f'    Low        HAND <= {b_low:5.2f} m   (P >= 0.05)')

    cls = np.zeros(hand.shape, dtype='uint8')
    cls[ok & (hand <= b_low)] = 1
    cls[ok & (hand <= b_mod)] = 2
    cls[ok & (hand <= b_high)] = 3
    cls = cls * SCALE
    # Sentinel, applied last so it cannot be overwritten by a class.
    cls[~ok] = UNDETERMINED
    print()
    for name, k in (('High', 3), ('Moderate', 2), ('Low', 1), ('Negligible', 0)):
        n = int((cls == k * SCALE).sum())
        print(f'    {name:<12} {n:>9,} cells  {n / cls.size * 100:5.1f}%')
    n = int((cls == UNDETERMINED).sum())
    print(f'    {"Undetermined":<12} {n:>9,} cells  {n / cls.size * 100:5.1f}%'
          f'   (sentinel {UNDETERMINED}, not a class)')

    os.makedirs(OUT, exist_ok=True)
    b = write_png_gray(f'{OUT}/hand.png', cls)

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from hand_tiles import write_tiles, OUT as TILE_OUT
    write_tiles(cls, W, S, E, N, SCALE, UNDETERMINED)
    print(f'\n  -> {OUT}/hand.png  ({b / 1024:.0f} KB)')

    mpath = f'{OUT}/manifest.json'
    m = json.load(open(mpath, encoding='utf-8'))
    m['layers']['hand'] = {
        'file': '/terrain-assam/hand.png',
        'classes': HAND_CLASS,
        'scale': SCALE,
        'bytes': b,
        'thresholdM': {'high': b_high, 'moderate': b_mod, 'low': b_low},
        'undeterminedValue': UNDETERMINED,
        'coverage': {
            'primary': round(float(okp.mean()), 4),
            'fallbackFilled': round(float(filled.mean()), 4),
            'undetermined': round(float((~ok).mean()), 4),
        },
        'calibration': {
            'source': 'flood_frequency_1999_2000_2004.tif (3 - stored value)',
            'aucRoc': round(float(auc), 3),
            'youdenThresholdM': round(float(T), 2),
            'truePositiveRate': round(float(tpr[j]), 3),
            'falsePositiveRate': round(float(fpr[j]), 3),
            'channelAccumulationCells': ACC_CELLS,
            'fallbackAccumulationCells': FALLBACK_ACC_CELLS,
        },
    }
    json.dump(m, open(mpath, 'w', encoding='utf-8'), indent=1)
    print(f'  -> {mpath}  (layer entry "hand")')
    return 0


if __name__ == '__main__':
    sys.exit(main())
