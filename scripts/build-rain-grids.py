"""
Numeric rain grids per case, for scoring rather than for drawing.

    python scripts/build-rain-grids.py            # all cases
    python scripts/build-rain-grids.py WAYANAD    # one

Writes public/layers/rain-grid-<CASE>.json: rain in mm per 3 h window on the
native model grid, cropped to the case's search extent.

WHY A SEPARATE FILE FROM THE OVERLAY PNGs
-----------------------------------------
The existing sequence PNGs are colourised into eight bands for the eye. Reading
numbers back out of them would recover the band, not the value, and would make
the ranking depend on a palette. This emits the numbers the PNGs were drawn
from, so the field on screen and the field in the score are the same field.

Critically, each case reads the SAME SOURCE its overlay does -- ECMWF forecast
for Wayanad and the live Assam case, ERA5 reanalysis for Fani. Substituting
reanalysis for forecast on Wayanad would rank sites against rain nobody could
have known about at the time, while the map showed the forecast.

RESOLUTION, AND WHAT IT CAN AND CANNOT SUPPORT
----------------------------------------------
0.25 degrees, about 28 km. Measured over the search discs this is coarse but
NOT uniform, which is the thing that had to be checked before ranking on it:

    Wayanad,     30 km radius:  9 cells, 3.8-17.8 mm, CV 42%
    Kendrapara,  30 km radius:  9 cells, 1.3- 3.8 mm, CV 32%
    Wayanad,    100 km radius: 57 cells, 1.7-17.8 mm, CV 36%

So a rain term does reorder sites. What it cannot do is resolve a valley: at
28 km one cell spans the whole of a small search area, and below roughly a
20 km radius the field is close to flat and the term stops discriminating.
The application says so where it is used rather than implying otherwise.

Output grid is row-major, row 0 NORTHERNMOST, and `bounds` are the outer cell
EDGES, so a reader can index directly:

    col = floor((lon - w) / (e - w) * width)
    row = floor((n - lat) / (n - s) * height)
"""
import importlib.util
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = 'sihrivererosion'

#: Half-width of the emitted box, degrees. 1.3 deg is ~145 km north-south,
#: comfortably past the 100 km maximum search radius with margin for the
#: bilinear read at the edge.
HALF_DEG = 1.3

STEP_H = 3

CASES = {
    'WAYANAD': dict(
        source='ecmwf', run='20240729', cycle='00z', prefix='ecmwf',
        origin=(76.15, 11.45),
        label='ECMWF IFS HRES open data, run 2024-07-29 00Z',
        kind='forecast'),
    'ASSAM': dict(
        source='ecmwf', run='20260904', cycle='18z', prefix='ecmwf-live',
        origin=(94.22, 26.95),
        label='ECMWF IFS HRES open data, latest operational run',
        kind='forecast'),
    'WESTBENGAL': dict(
        source='ecmwf', run='20260904', cycle='18z', prefix='ecmwf-live',
        origin=(88.10, 21.90),
        label='ECMWF IFS HRES open data, latest operational run',
        kind='forecast'),
    'KENDRAPARA': dict(
        source='era5', start='2019-05-02T00:00:00', hours=48,
        origin=(86.94, 20.63),
        label='ERA5 hourly reanalysis, 02-04 May 2019',
        kind='reanalysis'),
}


def box_for(origin):
    lon, lat = origin
    return (lon - HALF_DEG, lat - HALF_DEG, lon + HALF_DEG, lat + HALF_DEG)


def load_ecmwf_module(run, cycle, prefix):
    """Re-execute fetch-ecmwf.py with this run selected.

    Its run is read from the environment at module scope, so a fresh
    exec_module is how a second run gets picked up. Importing once and mutating
    the constant afterwards would leave PREFIX pointing at the first run.
    """
    os.environ['ECMWF_RUN'] = run
    os.environ['ECMWF_CYCLE'] = cycle
    os.environ['ECMWF_PREFIX'] = prefix
    spec = importlib.util.spec_from_file_location(
        f'fetch_ecmwf_{run}', os.path.join(HERE, 'fetch-ecmwf.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_ecmwf(case, cfg):
    """3 h incremental rain from the archived forecast, cropped to the case."""
    ec = load_ecmwf_module(cfg['run'], cfg['cycle'], cfg['prefix'])
    scratch = os.environ.get('SCRATCH', '.')
    w, s, e, n = box_for(cfg['origin'])

    prev = None
    frames = []
    meta = {}
    for step in ec.STEPS:
        raw, _ = ec.tp_message(step)
        vals, lats, lons, _m = ec.decode(
            raw, os.path.join(scratch, f'rg-tp{step}.grib2'))
        ii = np.where((lats >= s) & (lats <= n))[0]
        jj = np.where((lons >= w) & (lons <= e))[0]
        sub = vals[ii.min():ii.max() + 1, jj.min():jj.max() + 1]
        la = lats[ii.min():ii.max() + 1]
        lo = lons[jj.min():jj.max() + 1]
        if la[0] < la[-1]:
            sub, la = sub[::-1], la[::-1]
        if not meta:
            half = 0.125
            meta = dict(
                bounds=[round(float(lo[0] - half), 4),
                        round(float(la[-1] - half), 4),
                        round(float(lo[-1] + half), 4),
                        round(float(la[0] + half), 4)],
                width=int(sub.shape[1]), height=int(sub.shape[0]))
        if prev is not None:
            inc = np.maximum(sub - prev, 0.0)
            frames.append(dict(
                step=step, validMinutes=step * 60, windowHours=STEP_H,
                mm=[round(float(v), 2) for v in inc.ravel()]))
            print(f'  +{step:02d}h  max {inc.max():6.1f} mm  '
                  f'mean {inc.mean():5.2f}')
        prev = sub

    run_iso = (f'{cfg["run"][:4]}-{cfg["run"][4:6]}-{cfg["run"][6:]}'
               f'T{cfg["cycle"][:2]}:00:00Z')
    return meta, frames, run_iso


def build_era5(case, cfg):
    """3 h rain summed from ERA5 hourly, cropped to the case."""
    import ee
    import urllib.request
    from datetime import datetime, timedelta, timezone
    import rasterio

    ee.Initialize(project=PROJECT)
    w, s, e, n = box_for(cfg['origin'])
    box = ee.Geometry.Rectangle([w, s, e, n])
    t0 = datetime.fromisoformat(cfg['start']).replace(tzinfo=timezone.utc)
    scratch = os.environ.get('SCRATCH', '.')

    meta = {}
    frames = []
    for step in range(STEP_H, cfg['hours'] + 1, STEP_H):
        a = t0 + timedelta(hours=step - STEP_H)
        b = t0 + timedelta(hours=step)
        img = (ee.ImageCollection('ECMWF/ERA5/HOURLY')
               .filterDate(a.strftime('%Y-%m-%dT%H:%M:%S'),
                           b.strftime('%Y-%m-%dT%H:%M:%S'))
               .select('total_precipitation').sum().multiply(1000.0)
               .rename('mm'))
        url = img.clip(box).getDownloadURL({
            'scale': 27830, 'region': box, 'format': 'GEO_TIFF',
            'crs': 'EPSG:4326'})
        tmp = os.path.join(scratch, f'rg-era5-{step:02d}.tif')
        urllib.request.urlretrieve(url, tmp)
        with rasterio.open(tmp) as d:
            mm = np.nan_to_num(d.read(1).astype('float32'), nan=0.0)
            bb = d.bounds
        if not meta:
            meta = dict(
                bounds=[round(float(bb.left), 4), round(float(bb.bottom), 4),
                        round(float(bb.right), 4), round(float(bb.top), 4)],
                width=int(mm.shape[1]), height=int(mm.shape[0]))
        frames.append(dict(
            step=step, validMinutes=step * 60, windowHours=STEP_H,
            mm=[round(float(v), 2) for v in mm.ravel()]))
        print(f'  +{step:02d}h  max {mm.max():6.1f} mm  mean {mm.mean():5.2f}')

    return meta, frames, t0.strftime('%Y-%m-%dT%H:%M:00Z')


def main(only=None):
    os.makedirs('public/layers', exist_ok=True)
    for case, cfg in CASES.items():
        if only and case != only:
            continue
        print(f'\n{case}: {cfg["label"]}')
        try:
            if cfg['source'] == 'ecmwf':
                meta, frames, run_iso = build_ecmwf(case, cfg)
            else:
                meta, frames, run_iso = build_era5(case, cfg)
        except Exception as exc:                                # noqa: BLE001
            print(f'  FAILED: {type(exc).__name__}: {str(exc)[:200]}')
            print('  (leaving any existing grid in place rather than writing '
                  'a partial one)')
            continue

        ist = ''
        try:
            import datetime as _dt
            t = _dt.datetime.strptime(run_iso, '%Y-%m-%dT%H:%M:00Z')
            ist = (t + _dt.timedelta(hours=5, minutes=30)).strftime(
                '%Y-%m-%dT%H:%M:00+05:30')
        except Exception:                                       # noqa: BLE001
            ist = run_iso

        out = dict(
            case=case, source=cfg['label'], kind=cfg['kind'],
            run=run_iso, runIst=ist, stepHours=STEP_H,
            cellDeg=0.25,
            note=('mm per 3 h window on the native model grid. Row-major, row 0 '
                  'northernmost; bounds are outer cell edges. ~28 km: it '
                  'reorders sites but cannot resolve a valley.'),
            **meta, frames=frames)
        path = f'public/layers/rain-grid-{case}.json'
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(out, f)
        kb = os.path.getsize(path) / 1024
        print(f'  wrote {path}  {meta["width"]}x{meta["height"]} cells, '
              f'{len(frames)} frames, {kb:.0f} kB')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
