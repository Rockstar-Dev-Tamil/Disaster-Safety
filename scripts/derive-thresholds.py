"""
Derive per-cell rainfall return levels for Wayanad from the GPM IMERG daily
archive, replacing the fixed IMD category boundary with a locally-grounded
statistic.

WHY THIS EXISTS
    IMERG under-reads orographic extremes here by roughly a factor of three, so
    comparing an IMERG accumulation against a gauge-calibrated IMD threshold
    (204.5 mm) reports "no exceedance" for an event that killed ~400 people.
    Comparing IMERG against IMERG removes the bias from both sides: a 1-in-N
    year accumulation FOR THIS CELL IN THIS DATASET is self-consistent.
    It also fixes something the national threshold never handled -- 204.5 mm
    means something entirely different in Wayanad than in Rajasthan.

METHOD
    Annual maximum daily accumulation per 0.1 deg cell over the monsoon window,
    fitted with a Gumbel (EV1) distribution by L-moments, which is standard for
    annual-maximum rainfall series and stable at small sample sizes.

YEAR ORDER AND EARLY STOPPING
    Years are visited in a deterministic SPREAD order, not chronologically.
    That matters: the tail of an extreme-value fit is set by rare years, so
    stopping after a contiguous block starting in 1998 would exclude 2018 and
    2019 -- exactly Kerala's extreme years -- and understate every return level.
    Spread ordering means any stopping point still spans the whole record.

    Fetching stops once the fitted 25-year return level has moved less than
    TOL_PCT for STABLE_YEARS consecutive additions. The stopping point is
    recorded and reported, because a return level is only as good as the number
    of annual maxima behind it.

    The event year is excluded from the baseline, otherwise the event would
    help define the threshold it is being tested against.
"""
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

COLLECTION = 'C2723754864-GES_DISC'
BASE = f'https://opendap.earthdata.nasa.gov/collections/{COLLECTION}/granules/'
LON0, LON1, LAT0, LAT1 = 2556, 2564, 1014, 1020
CE = (f'/precipitation[0][{LON0}:{LON1}][{LAT0}:{LAT1}];'
      f'/lon[{LON0}:{LON1}];/lat[{LAT0}:{LAT1}]')

TOKEN = open('.earthdata_token').read().strip()

BASELINE_YEARS = list(range(1998, 2024))     # 2024 excluded: the event year
MONSOON = [(6, 30), (7, 31), (8, 31), (9, 30)]
TARGET_RP = 25                               # return period the stop test watches
TOL_PCT = 2.0                                # per-year movement considered settled
STABLE_YEARS = 3
WORKERS = 16


def spread_order(years):
    """Deterministic order that spreads across the record rather than marching
    through it, so an early stop still samples the whole period."""
    out, todo = [], list(years)
    while todo:
        step = max(1, len(todo) // 2)
        out.append(todo.pop(0))
        if todo:
            out.append(todo.pop(min(step, len(todo) - 1)))
    return out


def days_of(year):
    for month, n in MONSOON:
        for day in range(1, n + 1):
            yield f'{year}{month:02d}{day:02d}'


def fetch_day(ymd):
    name = f'3B-DAY.MS.MRG.3IMERG.{ymd}-S000000-E235959.V07B.nc4'
    gid = urllib.parse.quote(f'GPM_3IMERGDF.07:{name}', safe='')
    url = f'{BASE}{gid}.dap.csv?' + urllib.parse.urlencode({'dap4.ce': CE})
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                text = r.read().decode('utf-8', 'replace')
            rows = {}
            for line in text.splitlines():
                if line.startswith('/precipitation['):
                    head, _, vals = line.partition(',')
                    idx = int(head.split('][')[1].rstrip(']'))
                    rows[idx] = [float(v) for v in vals.split(',')]
            if rows:
                return [rows[i] for i in sorted(rows)]
        except Exception:                                    # noqa: BLE001
            continue
    return None


def year_max(year):
    """Per-cell maximum daily accumulation across the monsoon window."""
    grids = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for g in pool.map(fetch_day, days_of(year)):
            if g:
                grids.append(g)
    if not grids:
        return None, 0
    ni, nj = len(grids[0]), len(grids[0][0])
    return [[max(max(0.0, g[i][j]) for g in grids) for j in range(nj)]
            for i in range(ni)], len(grids)


def gumbel_fit(sample):
    """L-moment fit. Returns (location, scale)."""
    x = sorted(sample)
    n = len(x)
    l1 = sum(x) / n
    l2 = sum((2 * (i + 1) - n - 1) * x[i] for i in range(n)) / (n * (n - 1)) if n > 1 else 0.0
    scale = l2 / math.log(2) if l2 > 0 else 1e-9
    loc = l1 - scale * 0.5772156649
    return loc, scale


def return_level(sample, rp):
    loc, scale = gumbel_fit(sample)
    return loc - scale * math.log(-math.log(1 - 1.0 / rp))


CACHE = os.path.join(os.environ.get('SCRATCH', '.'), 'annual-maxima.json')


def load_cache():
    try:
        with open(CACHE) as f:
            return {int(k): v for k, v in json.load(f).items()}
    except Exception:                                        # noqa: BLE001
        return {}


def save_cache(c):
    with open(CACHE, 'w') as f:
        json.dump(c, f)


def harvest():
    """Fetch every baseline year once, caching per-year per-cell maxima.
    Convergence behaviour can then be examined in any ordering without
    re-fetching -- which is the only way to test whether an early stop was
    actually safe rather than merely quiet."""
    cache = load_cache()
    todo = [y for y in BASELINE_YEARS if y not in cache]
    print(f'cached: {len(cache)} years, to fetch: {len(todo)}')
    for year in todo:
        grid, n = year_max(year)
        if grid is None:
            print(f'  {year}: no data')
            continue
        cache[year] = grid
        save_cache(cache)
        flat = [v for row in grid for v in row]
        print(f'  {year}: {n:3d} days  cell max {max(flat):6.1f} mm  '
              f'mean {sum(flat)/len(flat):6.1f} mm', flush=True)
    return cache


def main():
    order = spread_order(BASELINE_YEARS)
    print(f'baseline {BASELINE_YEARS[0]}-{BASELINE_YEARS[-1]} (event year excluded)')
    print(f'visit order: {order}\n')

    maxima = {}          # (i,j) -> list of annual maxima
    used, prev, stable, requests = [], None, 0, 0

    for year in order:
        grid, n = year_max(year)
        requests += sum(d for _, d in MONSOON)
        if grid is None:
            print(f'  {year}: no data, skipped')
            continue
        for i, row in enumerate(grid):
            for j, v in enumerate(row):
                maxima.setdefault((i, j), []).append(v)
        used.append(year)

        if len(used) < 5:
            print(f'  {year}: {n:3d} days, {len(used)} yr  (building sample)')
            continue

        levels = [return_level(v, TARGET_RP) for v in maxima.values()]
        cur = sum(levels) / len(levels)
        if prev is None:
            move = float('inf')
        else:
            move = abs(cur - prev) / prev * 100
        stable = stable + 1 if move < TOL_PCT else 0
        print(f'  {year}: {n:3d} days, {len(used):2d} yr  '
              f'RL{TARGET_RP} mean = {cur:6.1f} mm  move {move:5.2f}%'
              f'{"  <- settled" if move < TOL_PCT else ""}')
        prev = cur
        if stable >= STABLE_YEARS:
            print(f'\nconverged: {TARGET_RP}-yr level moved <{TOL_PCT}% for '
                  f'{STABLE_YEARS} consecutive years. Stopping at {len(used)} years.')
            break
    else:
        print(f'\nused the full record ({len(used)} years) without early stop.')

    # ---- emit --------------------------------------------------------------
    dest = os.path.join(os.environ.get('SCRATCH', '.'), 'thresholds.json')
    out = {
        'yearsUsed': sorted(used),
        'yearCount': len(used),
        'requests': requests,
        'window': 'Jun-Sep daily maxima',
        'method': 'Gumbel (EV1) fitted by L-moments to annual maximum daily accumulation',
        'cells': [],
    }
    for (i, j), sample in sorted(maxima.items()):
        out['cells'].append({
            'i': i, 'j': j,
            'lon': round(75.65 + i * 0.1, 2),
            'lat': round(11.45 + j * 0.1, 2),
            'n': len(sample),
            'observedMax': round(max(sample), 1),
            'rl': {str(rp): round(return_level(sample, rp), 1)
                   for rp in (2, 5, 10, 25, 50, 100)},
        })
    with open(dest, 'w') as f:
        json.dump(out, f, indent=1)
    print(f'wrote {dest}: {len(out["cells"])} cells, {len(used)} years, ~{requests} requests')


if __name__ == '__main__':
    if '--harvest' in sys.argv:
        harvest()
    else:
        main()
