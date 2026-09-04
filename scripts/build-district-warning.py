"""
Per-case district rainfall warnings, from observed rainfall and IMD's own
published category boundaries.

    python scripts/build-district-warning.py --case wayanad
    python scripts/build-district-warning.py --all

OUTPUT  public/layers/district-warning-<case>.geojson

WHAT THIS IS NOT
----------------
It is NOT the warning IMD issued. IMD's district warning API sits behind a key
at api.imd.gov.in and serves forecast days 1-5; there is no open archive of the
colour codes actually issued on 3 May 2019 or 30 July 2024, and the one
unauthenticated GeoJSON on the public site is a stale two-feature test file
("New District2", dated 2024-08-07). If the issued bulletins are wanted, that
is a licensing conversation with IMD, not a fetch.

WHAT IT IS
----------
IMD's 24 h category RATIOS, scaled by 0.60, applied to satellite-observed
rainfall per district for each case's own event window:

    lowest band     39 -  68 mm/24h    yellow
    middle band     69 - 122 mm/24h    orange
    highest band        >= 123 mm/24h  red

The scaling is why the labels are not IMD's category names: 39 mm is not
"heavy rain" under any IMD definition, and keeping the name on a moved
boundary would mislead more than renaming does. See SCALE_FACTOR below for the
sweep the number came from.

Each district takes the maximum rolling 24 h accumulation anywhere inside it
across the window, stepped every 3 h, from GPM IMERG V07. Real observation,
real thresholds, stated derivation -- and it differs per case, which the
habitation-derived layer it replaces could not.

THE BIAS THAT REMAINS
---------------------
The 0.60 factor was fitted to two events, so it makes those two read correctly
and says nothing about anywhere else. IMERG's under-read varies spatially --
worst over orography, mild over plains -- and a single national multiplier
cannot track that. The setting that makes the Ghats read correctly therefore
OVER-warns the plains, which is the opposite failure to the one it fixed.

Read the bands as relative severity within one event, not as absolute rainfall
categories, and not as a statement about how two different events compare. The
principled version fits return levels per district; this is not that.
"""
import argparse
import json
import os
import sys

import numpy as np
import rasterio.features
from rasterio.transform import from_bounds

PROJECT = os.environ.get('EE_PROJECT', 'sihrivererosion')
DISTRICTS = 'public/geo/india-districts.json'
OUT_DIR = 'public/layers'

# India, matching the map's other national layers.
W, S, E, N = 67.875, 5.875, 97.625, 37.625
SCALE_M = 11132          # ~0.1 deg, IMERG's native grid

#: Scale factor on IMD's published boundaries.
#:
#: IMD's categories are gauge-calibrated and IMERG under-reads orographic
#: extremes; unscaled, Wayanad district comes out ORANGE for the day around 400
#: people died, and Cyclone Fani produces no red district anywhere. Swept
#: against both events in scripts/sweep-warning-thresholds.py:
#:
#:   factor  red thr   Wayanad case            Fani case
#:     1.00      204   5 red, Wayanad ORANGE   0 red, Puri ORANGE
#:     0.70      143   21 red, Wayanad RED     0 red, Puri ORANGE
#:     0.60      123   32 red, Wayanad RED     7 red, Puri RED      <- used
#:     0.50      102   48 red                  17 red
#:
#: 0.60 is the loosest factor at which both anchors read correctly -- Wayanad
#: red for a catastrophic debris flow, Puri red for an ESCS landfall -- while
#: red stays 1-4% of districts rather than blanketing the map.
#:
#: THIS IS A CALIBRATION CONVENIENCE, NOT A DERIVATION. A single national
#: multiplier cannot fix a bias that varies spatially: at whatever setting makes
#: the Ghats read correctly it will over-warn the plains. The principled version
#: fits return levels to each district's own IMERG record, as
#: scripts/derive-thresholds.py already does for the Wayanad cell.
SCALE_FACTOR = 0.60

#: Bands after scaling. The LABELS deliberately no longer carry IMD's category
#: names: 39 mm is not "heavy rain" under any IMD definition, and keeping the
#: name on a moved boundary would be the more misleading of the two options.
CATEGORIES = [
    (204.5 * SCALE_FACTOR, 'RED', 'Highest band, >= 123 mm/24h observed'),
    (115.6 * SCALE_FACTOR, 'ORANGE', 'Middle band, 69-122 mm/24h observed'),
    (64.5 * SCALE_FACTOR, 'YELLOW', 'Lowest band, 39-68 mm/24h observed'),
]

CASES = {
    'wayanad': {'start': '2024-07-29', 'end': '2024-07-31',
                'label': 'Wayanad debris flow, 29-30 July 2024'},
    'kendrapara': {'start': '2019-05-02', 'end': '2019-05-04',
                   'label': 'Cyclone Fani, 2-3 May 2019'},
    'assam': {'start': None, 'end': None,
              'label': 'Live case, most recent 48 h available'},
}


def classify(mm):
    for lo, code, label in CATEGORIES:
        if mm >= lo:
            return code, label
    return None, None


def max_24h_image(ee, start, end):
    """Pixel-wise maximum rolling 24 h accumulation over the window.

    Stepped every 3 h rather than taking calendar days: IMD's day runs
    08:30-08:30 IST, and a fixed daily boundary can split a single night's
    rainfall across two days and under-report the peak by half.
    """
    coll = (ee.ImageCollection('NASA/GPM_L3/IMERG_V07')
            .filterDate(start, end)
            .select('precipitation'))
    n = coll.size().getInfo()
    start_ms = ee.Date(start).millis()
    end_ms = ee.Date(end).millis()
    span_h = ee.Number(end_ms).subtract(start_ms).divide(3600000)
    offsets = ee.List.sequence(0, span_h.subtract(24), 3)

    def window(off):
        a = ee.Date(start_ms).advance(ee.Number(off), 'hour')
        b = a.advance(24, 'hour')
        # IMERG precipitation is mm/hr over a 30 min step, so depth is rate/2.
        return (coll.filterDate(a, b).sum().multiply(0.5)
                .rename('mm').set('t', a.millis()))

    return ee.ImageCollection(offsets.map(window)).max().rename('mm24'), n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--case', choices=sorted(CASES))
    ap.add_argument('--all', action='store_true')
    a = ap.parse_args()
    if not (a.case or a.all):
        ap.error('pick --case or --all')

    import ee
    import urllib.request
    try:
        ee.Initialize(project=PROJECT)
    except Exception as exc:                                   # noqa: BLE001
        print(f'Earth Engine not ready: {str(exc)[:160]}')
        return 2

    gj = json.load(open(DISTRICTS, encoding='utf-8'))
    box = ee.Geometry.Rectangle([W, S, E, N])
    scratch = os.environ.get('SCRATCH', '.')
    names = [a.case] if a.case else list(CASES)

    for name in names:
        cfg = CASES[name]
        start, end = cfg['start'], cfg['end']
        if start is None:
            # Live: the most recent 48 h the collection actually holds. IMERG
            # final run lags, so this is whatever is published, not "now".
            latest = ee.Date(ee.ImageCollection('NASA/GPM_L3/IMERG_V07')
                             .limit(1, 'system:time_start', False)
                             .first().get('system:time_start'))
            end = latest.format('YYYY-MM-dd').getInfo()
            start = latest.advance(-2, 'day').format('YYYY-MM-dd').getInfo()
            print(f'\n{name}: live window resolved to {start} .. {end}')

        img, nimg = max_24h_image(ee, start, end)
        print(f'\n{name}  {cfg["label"]}')
        print(f'  {start} .. {end}   {nimg} half-hourly images')

        url = img.clip(box).getDownloadURL({
            'scale': SCALE_M, 'region': box,
            'format': 'GEO_TIFF', 'crs': 'EPSG:4326'})
        tif = os.path.join(scratch, f'imd24-{name}.tif')
        urllib.request.urlretrieve(url, tif)
        with rasterio.open(tif) as d:
            mm = np.nan_to_num(d.read(1).astype('float32'), nan=0.0)
            tr = d.transform
            h, w = mm.shape
        print(f'  grid {w} x {h}   national max 24 h {mm.max():.1f} mm')

        feats = []
        counts = {'RED': 0, 'ORANGE': 0, 'YELLOW': 0}
        for f in gj['features']:
            geom = f.get('geometry')
            if not geom:
                continue
            mask = rasterio.features.rasterize(
                [(geom, 1)], out_shape=(h, w), transform=tr,
                fill=0, default_value=1, all_touched=True, dtype='uint8')
            if not mask.any():
                continue
            peak = float(mm[mask == 1].max())
            code, label = classify(peak)
            if not code:
                continue
            counts[code] += 1
            p = f['properties']
            feats.append({
                'type': 'Feature',
                'geometry': geom,
                'properties': {
                    'name': p.get('name'),
                    'state': p.get('state'),
                    'warning': code,
                    'category': label,
                    'maxMm24h': round(peak, 1),
                },
            })

        dest = os.path.join(OUT_DIR, f'district-warning-{name}.geojson')
        json.dump({'type': 'FeatureCollection',
                   'case': name, 'event': cfg['label'],
                   'window': [start, end],
                   'note': f'IMD 24 h category ratios scaled by {SCALE_FACTOR} and '
                           'applied to GPM IMERG V07 observed rainfall. NOT IMD '
                           'categories and NOT the warning IMD issued.',
                   'features': feats},
                  open(dest, 'w', encoding='utf-8'), separators=(',', ':'))
        print(f'  red {counts["RED"]}   orange {counts["ORANGE"]}   '
              f'yellow {counts["YELLOW"]}   of {len(gj["features"])} districts')
        print(f'  -> {dest}  ({os.path.getsize(dest) / 1024:.0f} kB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
