"""
Flood susceptibility from WRI Aqueduct Flood Hazard Maps V2, via Earth Engine.

    python scripts/fetch-aqueduct.py --probe
    python scripts/fetch-aqueduct.py --fetch

WHY THIS REPLACES WHAT CAME BEFORE
----------------------------------
The Assam layer so far was a three-year observed composite (1999, 2000, 2004)
with an unidentified publisher, plus a HAND model calibrated against it to
AUC 0.715. Aqueduct is better on the axis that matters for siting: it is a
published, physically modelled inundation product carrying NINE RETURN PERIODS,
so a cell can be described by how OFTEN it floods rather than by whether it
happened to flood in three sampled years. Absence in a three-year sample was
never evidence of safety; a 1-in-1000 return period is a statement about
safety, with a number attached.

What is lost is resolution. Aqueduct is 30 arcsec, about 900 m at this
latitude, against the 100 m analysis grid -- one Aqueduct cell covers roughly
81 analysis cells. It cannot see which side of an embankment a hamlet sits on.
HAND, at 100 m, can. So this is not strictly an upgrade: it trades spatial
detail for calibrated frequency, and both rasters are kept.

THE MEASURE
-----------
For each cell, the SMALLEST return period at which it is inundated. A cell wet
at RP2 floods about every other year; one wet only at RP250 floods twice a
millennium. That is a susceptibility scale with physical meaning, unlike a
binary extent.

FLOOD TYPE PER COAST
--------------------
Assam is `inunriver` -- the Brahmaputra. Kendrapara is `inuncoast` -- storm
surge, which is the hazard that actually threatens that shoreline. The Odisha
snippet supplied used `inunriver` over the Assam rectangle, which was plainly a
copy of the first one; it is read here as coastal over Kendrapara.
"""
import argparse
import os
import sys
import urllib.request

PROJECT = os.environ.get('EE_PROJECT', 'sihrivererosion')
OUT_DIR = 'data/aqueduct'

#: Every historical return period the collection carries.
RETURN_PERIODS = [2, 5, 10, 25, 50, 100, 250, 500, 1000]

#: Metres of modelled depth before a cell counts as inundated. Above zero to
#: drop float noise, below anything that would matter on the ground.
DEPTH_M = 0.05

AOIS = {
    'assam': {
        'box': [93.85, 26.60, 94.75, 27.40],     # the Majuli terrain stack
        'floodtype': 'inunriver',
        'scale': 300,
        'extra': {},
    },
    'assam-region': {
        'box': [89.7, 24.1, 96.0, 28.2],         # the box in your snippet
        'floodtype': 'inunriver',
        'scale': 900,
        'extra': {},
    },
    # A cyclone brings both mechanisms: surge from the sea and riverine flood
    # from the rain it dumps inland. Fetched separately and combined on the
    # smallest return period, because a cell inundated by either is inundated.
    'kendrapara': {
        'box': [85.95, 19.70, 87.95, 21.55],
        'floodtype': 'inuncoast',
        'scale': 300,
        # Coastal historical carries four years and two subsidence treatments.
        # 2010 with no subsidence is the observed baseline; `wtsub` adds modelled
        # land subsidence, which is real on this delta but is a projection, not
        # history, and would quietly turn a baseline into a forecast.
        'extra': {'year': 2010, 'subsidence': 'nosub'},
    },
    'kendrapara-river': {
        'box': [85.95, 19.70, 87.95, 21.55],
        'floodtype': 'inunriver',
        'scale': 300,
        'extra': {},
    },
    # Western Sundarbans: Ghoramara, Sagar and the Hooghly mouth. Same two
    # mechanisms as Kendrapara and for the same reason -- this coast takes
    # surge from the Bay and riverine flood from the Hooghly and its
    # distributaries, and a cell inundated by either is inundated.
    'westbengal': {
        'box': [87.30, 21.10, 89.05, 22.80],
        'floodtype': 'inuncoast',
        'scale': 300,
        'extra': {'year': 2010, 'subsidence': 'nosub'},
    },
    'westbengal-river': {
        'box': [87.30, 21.10, 89.05, 22.80],
        'floodtype': 'inunriver',
        'scale': 300,
        'extra': {},
    },
}


def init():
    import ee
    try:
        ee.Initialize(project=PROJECT)
    except Exception as exc:                                   # noqa: BLE001
        print(f'Earth Engine not ready for project "{PROJECT}": {str(exc)[:160]}')
        print('\n  Note the project ID is lowercase; the display name is not the ID.')
        sys.exit(2)
    return ee


def min_return_period(ee, cfg):
    """Smallest return period at which each cell is inundated.

    Built by overwriting from the LARGEST return period down, so the smallest
    one that wets a cell is what survives. NO_FLOOD stands for "dry at every
    modelled return period", which is a different statement from "not modelled"
    and is kept distinct.
    """
    NO_FLOOD = 9999
    coll = (ee.ImageCollection('WRI/Aqueduct_Flood_Hazard_Maps/V2')
            .filter(ee.Filter.eq('floodtype', cfg['floodtype']))
            .filter(ee.Filter.eq('climatescenario', 'historical')))
    for k, v in cfg['extra'].items():
        coll = coll.filter(ee.Filter.eq(k, v))

    out = ee.Image.constant(NO_FLOOD).toInt16()
    used = []
    for rp in sorted(RETURN_PERIODS, reverse=True):
        sub = coll.filter(ee.Filter.eq('returnperiod', rp))
        n = sub.size().getInfo()
        if n == 0:
            continue
        used.append((rp, n))
        wet = sub.mosaic().select('inundation_depth').gt(DEPTH_M)
        out = out.where(wet, rp)
    return out.rename('min_rp'), used


def probe(ee):
    for name, cfg in AOIS.items():
        box = ee.Geometry.Rectangle(cfg['box'])
        img, used = min_return_period(ee, cfg)
        print(f'\n=== {name}  {cfg["floodtype"]}  {cfg["box"]}')
        print(f'  images per return period: '
              f'{", ".join(f"rp{r}:{n}" for r, n in sorted(used))}')
        hist = img.reduceRegion(
            reducer=ee.Reducer.frequencyHistogram(), geometry=box,
            scale=cfg['scale'], maxPixels=1e10, bestEffort=True,
        ).getInfo().get('min_rp', {})
        total = sum(hist.values()) or 1
        print(f'  {"min return period":<22}{"cells":>10}{"share":>9}')
        for k in sorted(hist, key=lambda s: float(s)):
            lbl = 'never (dry at rp1000)' if float(k) > 5000 else f'{int(float(k))} yr'
            print(f'  {lbl:<22}{int(hist[k]):>10,}{hist[k] / total * 100:>8.1f}%')


def fetch(ee, only=None):
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, cfg in AOIS.items():
        if only and name != only:
            continue
        box = ee.Geometry.Rectangle(cfg['box'])
        img, _ = min_return_period(ee, cfg)
        url = img.clip(box).getDownloadURL({
            'scale': cfg['scale'], 'region': box,
            'format': 'GEO_TIFF', 'crs': 'EPSG:4326',
        })
        dest = os.path.join(OUT_DIR, f'{name}-minrp.tif')
        print(f'  {name:<14} -> {dest}', flush=True)
        urllib.request.urlretrieve(url, dest)
        print(f'  {"":<14}    {os.path.getsize(dest) / 1024:.0f} kB')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--probe', action='store_true')
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--only', help='one AOI name')
    a = ap.parse_args()
    if not (a.probe or a.fetch):
        ap.error('pick --probe or --fetch')
    ee = init()
    print(f'Earth Engine ready, project "{PROJECT}"')
    if a.probe:
        probe(ee)
    if a.fetch:
        fetch(ee, a.only)
    return 0


if __name__ == '__main__':
    sys.exit(main())
