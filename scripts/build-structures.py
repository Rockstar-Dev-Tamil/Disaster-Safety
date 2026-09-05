"""
Structure density per analysis cell, from Google Open Buildings 2.5D Temporal.

    python scripts/build-structures.py                 # every stack
    python scripts/build-structures.py westbengal      # one

OUTPUT  public/terrain*/buildings.png    built fraction per cell, uint8
        manifest.json updated with the layer

WHY THIS EXISTS
---------------
`excludeBuiltUp` reads OSM land use, and OSM has barely mapped these coasts.
Measured over the shipped rasters before this was built:

    stack               unmapped   built-up seen
    terrain (Wayanad)      73.9%       0.5%
    terrain-kendrapara     97.5%       0.2%
    terrain-assam          92.8%       1.2%
    terrain-westbengal     97.0%       1.6%

Two tenths of one per cent of the Kendrapara delta recorded as built. On a coast
of dense village settlement that is not an undercount, it is near-total
blindness, and it means the console has been siting camps on ground it could
not see houses on.

WHY NOT RUN A BUILDING DETECTOR OURSELVES
-----------------------------------------
DeepGlobe's building track was trained on 30 cm WorldView, where a rural house
is ~27 px across. The imagery this project can obtain free is Sentinel-2 at
10 m, where the same house is UNDER ONE PIXEL -- a 30x gap. A detector fed data
30x coarser than its training does not degrade gracefully; it produces
confident, plausible nonsense, which is the worst failure mode for a siting
tool. Open Buildings is that model already run, by people who had the 50 cm
imagery.

WHY BUILT FRACTION AND NOT BUILDING COUNT
-----------------------------------------
Counting was tried first and abandoned on measurement. The count band
(`building_fractional_count`) has a 0.5 m native grid, so a 150 m cell is
90,000 input pixels -- past reduceResolution's 65,535 cap, needing a two-stage
aggregation that then exceeded Earth Engine's memory limit on any tile big
enough to be practical. The cheap alternative, letting the image pyramid
average and scaling back up, is biased +9 to +13 per cent because `mean` skips
masked pixels while the multiplier assumes a full cell -- and the bias GROWS
with cell size, so it cannot be calibrated away. Rasterising the v3 vector
footprints instead undercounted by 28 per cent.

`building_presence` has none of these problems. It is already a fraction, so
the pyramid mean is exactly the right operation, self-normalising over observed
pixels, and it runs in about a second per area instead of minutes. It is also
the better measure of the thing being asked: "how built-up is this ground".

Validated against four controls before anything was built on it:

    Kolkata, dense urban     mean 0.321   p90 0.513   max 0.685
    Kakdwip, delta town      mean 0.049   p90 0.130   max 0.414
    Sundarbans mangrove      mean 0.000   p90 0.000   max 0.000
    Ghoramara island         mean 0.003   p90 0.000   max 0.133

The mangrove control is the one that matters: a detector that hallucinated
would fill an uninhabited forest, and this one returns exactly zero.

WHAT IT IS NOT
--------------
A BUILDING IS NOT A DWELLING. Sheds, byres and pucca houses all detect alike,
so this is structure density and is named that. Turning it into population
needs an occupancy assumption this project does not have.

VINTAGE. The latest annual composite is 2023-06-30 -- structures as of roughly
three years ago, not today. On a coast losing land yearly, some of these are
now in the water, which the NDWI erosion layers can be used to check.
"""
import json
import os
import struct
import sys
import urllib.error
import urllib.request
import zlib

import numpy as np
import rasterio

PROJECT = 'sihrivererosion'
COLLECTION = 'GOOGLE/Research/open-buildings-temporal/v1'

STACKS = {
    'wayanad': 'public/terrain',
    'kendrapara': 'public/terrain-kendrapara',
    'assam': 'public/terrain-assam',
    'westbengal': 'public/terrain-westbengal',
}

#: Stored value is round(fraction * 255); real fraction is value * SCALE.
SCALE = 1.0 / 255.0


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


def presence_image(ee, box):
    """Latest annual building-presence composite over `box`.

    MOSAIC, not first(). Taking the first image of the filtered collection
    covers one tile and leaves the rest of the box empty without erroring --
    that reported 3.7 per cent of Kolkata's true building count.
    """
    sub = ee.ImageCollection(COLLECTION).filterBounds(box)
    latest = ee.Date(sub.aggregate_max('system:time_start'))
    sub = sub.filterDate(latest.advance(-1, 'day'), latest.advance(1, 'day'))
    return sub.select('building_presence').mosaic(), latest


def build(name, stack, ee):
    mp = os.path.join(stack, 'manifest.json')
    if not os.path.exists(mp):
        print(f'\n{name}: no manifest at {stack}, skipping')
        return
    m = json.load(open(mp, encoding='utf-8'))
    w, s, e, n = m['bounds']
    wd, ht = int(m['width']), int(m['height'])
    cell = float(m.get('cellMetres', 100))
    scratch = os.environ.get('SCRATCH', '.')

    box = ee.Geometry.Rectangle([w, s, e, n])
    pres, latest = presence_image(ee, box)
    date = ee.Date(latest).format('YYYY-MM-dd').getInfo()
    print(f'\n{name}: {wd} x {ht} at {cell:.0f} m   source composite {date}')

    tif = os.path.join(scratch, f'ob-presence-{name}.tif')
    if not (os.path.exists(tif) and os.path.getsize(tif) > 1000):
        url = pres.getDownloadURL({
            'region': box, 'scale': cell, 'format': 'GEO_TIFF',
            'crs': 'EPSG:4326'})
        try:
            urllib.request.urlretrieve(url, tif)
        except urllib.error.HTTPError as exc:            # noqa: PERF203
            print(f'  download failed: {exc.code} '
                  f'{exc.read().decode("utf8", "replace")[:200]}')
            return

    with rasterio.open(tif) as d:
        a = np.nan_to_num(d.read(1).astype('float32'), nan=0.0)
        tr = d.transform
    lats = np.linspace(n, s, ht)
    lons = np.linspace(w, e, wd)
    rows = np.clip(((lats - tr.f) / tr.e).astype(int), 0, a.shape[0] - 1)
    cols = np.clip(((lons - tr.c) / tr.a).astype(int), 0, a.shape[1] - 1)
    frac = np.clip(a[np.ix_(rows, cols)], 0.0, 1.0)

    arr = np.rint(frac * 255).astype('uint8')
    tot = wd * ht
    print(f'  built fraction  mean {frac.mean():.4f}   '
          f'p99 {np.percentile(frac, 99):.3f}   max {frac.max():.3f}')
    print(f'  {"threshold":<16}{"cells":>12}{"share":>9}')
    for thr in (0.001, 0.01, 0.02, 0.05, 0.10, 0.20):
        c = int((frac >= thr).sum())
        print(f'    >= {thr:<12.3f}{c:>12,}{c / tot * 100:>8.2f}%')

    b = write_png_gray(os.path.join(stack, 'buildings.png'), arr)
    m.setdefault('layers', {})['buildings'] = {
        'file': f'/{stack.split("public/", 1)[-1]}/buildings.png',
        'unit': 'built fraction',
        'scale': SCALE,
        'sourceDate': date,
        'bytes': b,
    }
    json.dump(m, open(mp, 'w', encoding='utf-8'))
    print(f'  -> {stack}/buildings.png ({b / 1024:.0f} kB), manifest updated')


def main():
    import ee
    ee.Initialize(project=PROJECT)
    want = sys.argv[1:] or list(STACKS)
    for nm in want:
        if nm not in STACKS:
            raise SystemExit(f'unknown stack {nm!r}; have {list(STACKS)}')
        build(nm, STACKS[nm], ee)
    return 0


if __name__ == '__main__':
    sys.exit(main())
