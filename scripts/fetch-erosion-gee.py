"""
Riverine erosion at Majuli from Sentinel-2, via Google Earth Engine.

AUTHENTICATION IS INTERACTIVE AND MUST BE DONE ONCE, BY YOU:

    earthengine authenticate

That opens a browser and writes a token to ~/.config/earthengine/credentials.
Nothing here can do it on your behalf. After that this script runs unattended.

    python scripts/fetch-erosion-gee.py --probe
    python scripts/fetch-erosion-gee.py --erosion

WHAT --probe DOES
-----------------
Exactly the snippet you supplied: least-cloudy S2 scene over the Majuli box in
a date window, and prints what came back -- id, date, cloud fraction, bands,
footprint. Run this first. It confirms the auth works and shows what the
archive actually holds before any analysis is built on top of it, the same way
the ShorelineMonitor pull was done.

WHAT --erosion DOES
-------------------
Two dry-season water masks a decade apart, differenced:

    erosion   land in the early epoch, water in the late one
    accretion water in the early epoch, land in the late one

Dry season (Jan-Mar) deliberately: the Brahmaputra's wet-season width is not
erosion, it is discharge, and comparing a June scene with a February one
measures the monsoon rather than the bank. Both epochs are taken from the same
months so the comparison is like for like.

Water is detected with MNDWI (green - SWIR1)/(green + SWIR1), which separates
water from wet sand and shadow better than NDWI on a sediment-laden river. The
threshold is not hardcoded -- it is fitted per epoch by Otsu on the actual
histogram, because a fixed 0 is wrong on turbid water.

WHAT THIS IS NOT
----------------
A single pair of epochs cannot separate permanent bank retreat from channel
migration that will reverse next season. The Brahmaputra braids; a bar that
disappears between two Februaries may return. Treat the output as observed
change over the window, not as a rate to extrapolate. A proper rate needs the
full annual series, which is the next step if this looks worth it.
"""
import argparse
import os
import sys

AOI = [94.1, 26.9, 94.7, 27.1]          # the box you gave, tight on Majuli
PROJECT = os.environ.get('EE_PROJECT', 'SIHRiverErosion')

#: Dry-season windows a decade apart. Sentinel-2 L2A (SR) starts 2017 for most
#: of the world; 2016 is L1C only, so the early epoch is 2017-19 pooled to get
#: enough cloud-free pixels rather than one scene.
EARLY = ('2017-01-01', '2019-04-01')
LATE = ('2023-01-01', '2025-04-01')

SCALE_M = 20        # S2 SWIR native; finer than needed to see a bank move
OUT_DIR = 'data/erosion'


def init():
    import ee
    try:
        ee.Initialize(project=PROJECT)
    except Exception as exc:                                   # noqa: BLE001
        print(f'Earth Engine not initialised for project "{PROJECT}".')
        print(f'  {str(exc)[:200]}')
        print('\nRun this once, in your own shell:\n\n    earthengine authenticate\n')
        sys.exit(2)
    return ee


def probe(ee):
    """Your snippet, plus a look at what it returned."""
    box = ee.Geometry.Rectangle(AOI)
    coll = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(box)
            .filterDate('2025-01-01', '2025-03-01')
            .sort('CLOUDY_PIXEL_PERCENTAGE'))
    n = coll.size().getInfo()
    print(f'collection: {n} scenes over {AOI} in 2025-01-01..2025-03-01')
    if not n:
        print('  nothing returned; widen the window')
        return
    img = coll.first()
    info = img.getInfo()
    props = info.get('properties', {})
    print(f'\nleast-cloudy scene')
    print(f'  id              {info.get("id")}')
    print(f'  date            {props.get("GENERATION_TIME") and ""}'
          f'{props.get("PRODUCT_ID", "?")}')
    print(f'  cloud %         {props.get("CLOUDY_PIXEL_PERCENTAGE")}')
    print(f'  MGRS tile       {props.get("MGRS_TILE")}')
    print(f'  bands           {len(info.get("bands", []))}: '
          f'{", ".join(b["id"] for b in info.get("bands", [])[:14])}')
    b = info.get('bands', [])
    if b:
        d = b[0]
        print(f'  first band grid {d.get("dimensions")} at '
              f'{d.get("crs")} {d.get("crs_transform", [])[:2]}')
    print('\n  scene cloud fractions, 10 least cloudy:')
    for s in coll.limit(10).aggregate_array('CLOUDY_PIXEL_PERCENTAGE').getInfo():
        print(f'    {s}')


def water_mask(ee, start, end, box):
    """Dry-season MNDWI water mask, Otsu-thresholded on its own histogram."""
    def mask_clouds(im):
        # SCL: 3 shadow, 8 medium cloud, 9 high cloud, 10 cirrus.
        scl = im.select('SCL')
        ok = (scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)))
        return im.updateMask(ok)

    coll = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(box)
            .filterDate(start, end)
            .filter(ee.Filter.calendarRange(1, 3, 'month'))
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
            .map(mask_clouds))

    comp = coll.median()
    mndwi = comp.normalizedDifference(['B3', 'B11']).rename('mndwi')

    # Otsu on the MNDWI histogram, so the split follows this epoch's own water.
    hist = mndwi.reduceRegion(
        reducer=ee.Reducer.histogram(255, 0.01),
        geometry=box, scale=SCALE_M * 3, maxPixels=1e9, bestEffort=True,
    ).get('mndwi')
    thr = otsu(ee, ee.Dictionary(hist))
    return mndwi.gt(thr).rename('water'), thr, coll.size()


def otsu(ee, histogram):
    """Between-class variance maximiser, on an ee histogram dictionary."""
    counts = ee.Array(histogram.get('histogram'))
    means = ee.Array(histogram.get('bucketMeans'))
    size = means.length().get([0])
    total = counts.reduce(ee.Reducer.sum(), [0]).get([0, 0])
    sums = means.multiply(counts).reduce(ee.Reducer.sum(), [0]).get([0, 0])
    mean = sums.divide(total)
    indices = ee.List.sequence(1, size)

    def bss(i):
        a_counts = counts.slice(0, 0, i)
        a_count = a_counts.reduce(ee.Reducer.sum(), [0]).get([0, 0])
        a_means = means.slice(0, 0, i)
        a_mean = (a_means.multiply(a_counts)
                  .reduce(ee.Reducer.sum(), [0]).get([0, 0])
                  .divide(a_count))
        b_count = total.subtract(a_count)
        b_mean = sums.subtract(a_count.multiply(a_mean)).divide(b_count)
        return (a_count.multiply(a_mean.subtract(mean).pow(2))
                .add(b_count.multiply(b_mean.subtract(mean).pow(2))))

    scores = indices.map(bss)
    return means.sort(ee.Array(scores)).get([-1])


def erosion(ee):
    box = ee.Geometry.Rectangle(AOI)
    early, thr_e, n_e = water_mask(ee, *EARLY, box)
    late, thr_l, n_l = water_mask(ee, *LATE, box)

    print(f'early {EARLY[0][:4]}-{EARLY[1][:4]}  scenes {n_e.getInfo()}  '
          f'MNDWI threshold {thr_e.getInfo():.4f}')
    print(f'late  {LATE[0][:4]}-{LATE[1][:4]}  scenes {n_l.getInfo()}  '
          f'MNDWI threshold {thr_l.getInfo():.4f}')

    eroded = late.And(early.Not()).rename('eroded')       # land -> water
    accreted = early.And(late.Not()).rename('accreted')   # water -> land

    px_m2 = SCALE_M * SCALE_M
    stats = (ee.Image.cat([eroded, accreted, early.rename('w_early'),
                           late.rename('w_late')])
             .reduceRegion(reducer=ee.Reducer.sum(), geometry=box,
                           scale=SCALE_M, maxPixels=1e10, bestEffort=True)
             .getInfo())
    print('\nchange over the window, hectares:')
    for k in ('eroded', 'accreted', 'w_early', 'w_late'):
        ha = stats.get(k, 0) * px_m2 / 10000.0
        print(f'  {k:<10} {ha:12,.0f} ha')

    # 0 none, 1 accreted, 2 eroded -- small integer classes, the convention the
    # other hazard rasters already use.
    classed = (ee.Image(0).where(accreted, 1).where(eroded, 2)
               .toByte().rename('change').clip(box))

    url = classed.getDownloadURL({
        'scale': SCALE_M, 'region': box, 'format': 'GEO_TIFF', 'crs': 'EPSG:4326',
    })
    os.makedirs(OUT_DIR, exist_ok=True)
    dest = os.path.join(OUT_DIR, 'majuli-change.tif')
    print(f'\ndownloading -> {dest}')
    import urllib.request
    urllib.request.urlretrieve(url, dest)
    print(f'  {os.path.getsize(dest) / 1024:.0f} kB')
    print('\n  0 = no change, 1 = accreted (water -> land), 2 = eroded (land -> water)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--probe', action='store_true',
                    help='run the supplied snippet and show what came back')
    ap.add_argument('--erosion', action='store_true',
                    help='two-epoch dry-season change, downloaded as GeoTIFF')
    a = ap.parse_args()
    if not (a.probe or a.erosion):
        ap.error('pick --probe or --erosion')

    ee = init()
    print(f'Earth Engine ready, project "{PROJECT}"\n')
    if a.probe:
        probe(ee)
    if a.erosion:
        erosion(ee)
    return 0


if __name__ == '__main__':
    sys.exit(main())
