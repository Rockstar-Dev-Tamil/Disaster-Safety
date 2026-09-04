"""
Satabhaya shoreline change from NDWI -- past against present.

    python scripts/satabhaya-ndwi.py review        # masks + coastlines, per epoch
    python scripts/satabhaya-ndwi.py overlay       # the combined deliverable

Satabhaya (20.633 N, 86.933 E, Rajnagar block, Kendrapara) is the village the
sea took: seven hamlets lost, 571 families moved to Bagapatia in 2018. It sits
~600 m from KANHUPUR, the habitation this project already carries, so the
overlay is about that case rather than beside it.

WHY COMPOSITES AND NOT TWO SCENES
---------------------------------
The obvious build is one clear scene then, one now. Measured on this AOI that
does not survive contact with the data:

  * The AOI straddles four Sentinel-2 tiles (footprint coverage 4.9 / 19.3 /
    25.1 / 100 per cent). Compare two scenes without checking coverage and the
    "change" is mostly which tile you happened to draw.
  * Restricted to full-coverage scenes, classified land still moves ~6 km2
    between dates in a single winter. That is tide over Gahirmatha's intertidal
    flats, and it is real change in the waterline that is not erosion.

The erosion signal over the Sentinel-2 era is smaller than that. ShorelineMonitor
puts this reach at -4.3 m/yr median, so 2016 -> 2026 is ~43 m of retreat: about
0.9 km2 spread along the AOI's coast, against a ~6 km2 tidal swing. A two-scene
comparison here would be reporting the tide.

So each epoch is a MEDIAN over every clear, full-coverage scene in a
season-matched window. The median takes the central waterline rather than an
arbitrary one, and averaging N scenes pulls the tidal term down by ~sqrt(N).
Seasons are matched (Nov-Mar both ends) so monsoon turbidity and flooding are
not doing the talking either.

The honest caption is therefore "median of N scenes, Nov 2015 - Mar 2016", not a
single date implying a single overflight. Both are printed.

WHAT THIS IS NOT
----------------
A two-epoch comparison illustrating known erosion. Not an erosion-rate study --
that is the DSAS/ShorelineMonitor transect work in src/data/shoreline-kendrapara.ts,
which fits a rate over 1988-2022 observations. Nothing here should be quoted as
a rate.

Sources: Copernicus Sentinel-2 (ESA), USGS Landsat Collection 2 Level-2.
"""
import io
import json
import math
import os
import sys
import urllib.request

import ee

PROJECT = 'sihrivererosion'

#: Satabhaya village, from its published location.
SATABHAYA = (86.933, 20.633)

#: AOI around the village, wide enough to carry the reach either side of it.
AOI_BOX = [86.85, 20.55, 87.05, 20.75]

#: Water threshold. Chosen from the measured histogram, not from habit: on a
#: clear scene here the land mode runs -0.65..-0.25 and the water mode
#: +0.25..+0.55, with ~1.5 per cent of pixels in between. Zero sits in the
#: middle of that trough, so the classification is insensitive to the exact
#: value -- which is the property worth having, and the reason to check.
NDWI_WATER = 0.0

#: Season-matched windows. Nov-Mar is the clear, calm, post-monsoon season here.
EPOCHS = {
    'past': ('2015-11-01', '2016-03-31'),
    'present': ('2025-11-01', '2026-03-31'),
}

#: Landsat reaches back three decades further, which matters: see report().
#: Nov 1990 is where a usable archive actually starts over this AOI: 1988-89
#: has no scenes at all and the single 1989-90 scene is cloud-covered. Probed,
#: not assumed -- the earliest date the archive nominally reaches is not the
#: earliest date it can answer with.
EPOCHS_LANDSAT = {
    'past': ('1990-11-01', '1991-03-31'),
    'present': ('2025-11-01', '2026-03-31'),
}

OUT = os.environ.get('SATABHAYA_OUT', 'out/satabhaya')

# --------------------------------------------------------------- collections


def aoi():
    return ee.Geometry.Rectangle(AOI_BOX)


def s2_clear(start, end, region):
    """Sentinel-2 L2A, cloud-free and fully covering the AOI.

    Coverage is filtered, not assumed. A scene clipping the corner of the AOI
    reports a fraction of the land and would read as sudden erosion.
    """
    def tag(img):
        scl = img.select('SCL')
        bad = scl.remap([3, 8, 9, 10], [1, 1, 1, 1], 0)
        cloud = bad.reduceRegion(
            ee.Reducer.mean(), region, 60, maxPixels=1e9).get('remapped')
        cov = img.select('B3').mask().reduceRegion(
            ee.Reducer.mean(), region, 60, maxPixels=1e9).get('B3')
        return img.set('aoi_cloud', cloud, 'aoi_cov', cov)

    return (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(region).filterDate(start, end)
            .map(tag)
            .filter(ee.Filter.lt('aoi_cloud', 0.01))
            .filter(ee.Filter.gt('aoi_cov', 0.999)))


def s2_ndwi(img):
    return img.normalizedDifference(['B3', 'B8']).rename('ndwi')


def s2_rgb(img):
    return img.select(['B4', 'B3', 'B2']).divide(10000)


def landsat_clear(start, end, region):
    """Landsat Collection 2 Level-2, TM and OLI merged, scaled to reflectance.

    Band positions differ between sensors, so both are renamed to green/nir/rgb
    before they meet. The C2 L2 scaling (DN * 2.75e-5 - 0.2) is applied because
    NDWI is only ratio-invariant to a scale factor, not to an offset.
    """
    def prep(green, nir, red, blue):
        def fn(img):
            opt = img.select([green, nir, red, blue]).multiply(0.0000275).add(-0.2)
            opt = opt.rename(['green', 'nir', 'red', 'blue'])
            qa = img.select('QA_PIXEL')
            # bits 1 dilated cloud, 2 cirrus, 3 cloud, 4 shadow
            bad = (qa.bitwiseAnd(1 << 1).neq(0)
                   .Or(qa.bitwiseAnd(1 << 2).neq(0))
                   .Or(qa.bitwiseAnd(1 << 3).neq(0))
                   .Or(qa.bitwiseAnd(1 << 4).neq(0)))
            out = opt.updateMask(bad.Not()).copyProperties(
                img, ['system:time_start'])
            out = ee.Image(out).set('src_id', img.get('LANDSAT_PRODUCT_ID'))
            cloud = bad.reduceRegion(
                ee.Reducer.mean(), region, 90, maxPixels=1e9).values().get(0)
            cov = opt.select('green').mask().reduceRegion(
                ee.Reducer.mean(), region, 90, maxPixels=1e9).get('green')
            return out.set('aoi_cloud', cloud, 'aoi_cov', cov)
        return fn

    tm = (ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
          .filterBounds(region).filterDate(start, end)
          .map(prep('SR_B2', 'SR_B4', 'SR_B3', 'SR_B1')))
    oli = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
           .filterBounds(region).filterDate(start, end)
           .map(prep('SR_B3', 'SR_B5', 'SR_B4', 'SR_B2')))
    oli9 = (ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
            .filterBounds(region).filterDate(start, end)
            .map(prep('SR_B3', 'SR_B5', 'SR_B4', 'SR_B2')))
    return (tm.merge(oli).merge(oli9)
            .filter(ee.Filter.lt('aoi_cloud', 0.05))
            .filter(ee.Filter.gt('aoi_cov', 0.99)))


def landsat_ndwi(img):
    return img.normalizedDifference(['green', 'nir']).rename('ndwi')


def landsat_rgb(img):
    return img.select(['red', 'green', 'blue'])


SENSORS = {
    's2': dict(label='Sentinel-2 L2A', scale=20, epochs=EPOCHS,
               clear=s2_clear, ndwi=s2_ndwi, rgb=s2_rgb,
               rgb_max=0.30, idprop='PRODUCT_ID', idslice=(11, 19)),
    'landsat': dict(label='Landsat C2 L2', scale=30, epochs=EPOCHS_LANDSAT,
                    clear=landsat_clear, ndwi=landsat_ndwi, rgb=landsat_rgb,
                    rgb_max=0.30, idprop='src_id', idslice=(17, 25)),
}

# ------------------------------------------------------------------ analysis


def epoch(sensor, which, region):
    """Median NDWI composite for one epoch, with the scene list behind it."""
    s = SENSORS[sensor]
    start, end = s['epochs'][which]
    col = s['clear'](start, end, region)
    n = col.size().getInfo()
    if n == 0:
        raise SystemExit(
            f'no clear full-coverage {s["label"]} scenes in {start}..{end} -- '
            f'widen the window rather than substituting a misleading date')
    nd = col.map(lambda i: s['ndwi'](i).copyProperties(
        i, ['system:time_start'])).median().rename('ndwi')
    rgb = col.map(s['rgb']).median()
    dates = sorted({d[:10] for d in col.aggregate_array('system:time_start')
                    .map(lambda t: ee.Date(t).format('YYYY-MM-dd'))
                    .getInfo()})
    return dict(ndwi=nd, rgb=rgb, n=n, dates=dates, start=start, end=end)


def land_mask(nd):
    """Binary land, cleaned of speckle.

    A raw threshold leaves single wet pixels inland and single dry pixels in
    the surf. focal_mode over a 1-pixel radius removes those without moving a
    real edge, which matters because the edge is the measurement.
    """
    return nd.lt(NDWI_WATER).focal_mode(1, 'square', 'pixels').rename('land')


def coast_edge(land):
    """One-pixel line on the land side of the boundary."""
    return land.subtract(land.focal_min(1, 'square', 'pixels')).selfMask()


def area_km2(mask, region, scale):
    v = mask.multiply(ee.Image.pixelArea()).reduceRegion(
        ee.Reducer.sum(), region, scale, maxPixels=1e10).values().get(0)
    return ee.Number(v).divide(1e6).getInfo()


def scene_jitter(sensor, which, region):
    """Per-scene land area inside one epoch: the noise floor, measured.

    Spread here is tide and classification noise. Any epoch-to-epoch difference
    smaller than this is not evidence of erosion, and saying so is the whole
    point of computing it.
    """
    s = SENSORS[sensor]
    start, end = s['epochs'][which]
    col = s['clear'](start, end, region)

    def tag(img):
        m = land_mask(s['ndwi'](img))
        a = m.multiply(ee.Image.pixelArea()).reduceRegion(
            ee.Reducer.sum(), region, s['scale'], maxPixels=1e10).get('land')
        return img.set('land_km2', ee.Number(a).divide(1e6))

    vals = col.map(tag).aggregate_array('land_km2').getInfo()
    vals = [v for v in vals if v]
    if len(vals) < 2:
        return dict(n=len(vals), mean=vals[0] if vals else 0, sd=0.0,
                    lo=vals[0] if vals else 0, hi=vals[0] if vals else 0)
    mean = sum(vals) / len(vals)
    sd = (sum((v - mean) ** 2 for v in vals) / (len(vals) - 1)) ** 0.5
    return dict(n=len(vals), mean=mean, sd=sd, lo=min(vals), hi=max(vals))


# ------------------------------------------------------------------- render


def fetch(img, region, path, dims=1600, fmt='png'):
    url = img.getThumbURL(
        {'region': region, 'dimensions': dims, 'format': fmt})
    os.makedirs(os.path.dirname(path), exist_ok=True)
    urllib.request.urlretrieve(url, path)
    return path, os.path.getsize(path)


def review(sensor='s2'):
    """Masks and coastlines for each epoch, separately, before any combining."""
    ee.Initialize(project=PROJECT)
    region = aoi()
    s = SENSORS[sensor]
    print(f'== {s["label"]} == AOI {AOI_BOX}, Satabhaya {SATABHAYA}\n')

    out = {}
    for which in ('past', 'present'):
        e = epoch(sensor, which, region)
        land = land_mask(e['ndwi'])
        edge = coast_edge(land)
        a = area_km2(land, region, s['scale'])
        j = scene_jitter(sensor, which, region)
        out[which] = dict(e=e, land=land, edge=edge, area=a, jitter=j)

        print(f'{which.upper():8} {e["start"]} .. {e["end"]}')
        print(f'   scenes in composite : {e["n"]}')
        print(f'   dates               : {", ".join(e["dates"][:6])}'
              + (' ...' if len(e['dates']) > 6 else ''))
        print(f'   land (composite)    : {a:.2f} km2')
        print(f'   per-scene land      : mean {j["mean"]:.2f}  sd {j["sd"]:.2f}'
              f'  range {j["lo"]:.2f}..{j["hi"]:.2f} km2  (n={j["n"]})')

        base = f'{OUT}/{sensor}-{which}'
        fetch(e['ndwi'].visualize(min=-0.6, max=0.6,
                                  palette=['7a5c2e', 'd8cdb4', 'ffffff',
                                           '8fb6d6', '11396b']),
              region, f'{base}-ndwi.png')
        fetch(land.visualize(min=0, max=1, palette=['0b2545', 'e6dfc8']),
              region, f'{base}-mask.png')
        colour = '#ffe14d' if which == 'past' else '#ff3b30'
        fetch(e['rgb'].visualize(min=0.0, max=s['rgb_max'])
              .blend(edge.visualize(palette=[colour])),
              region, f'{base}-coast.png')
        print(f'   wrote               : {base}-{{ndwi,mask,coast}}.png\n')

    d = out['past']['area'] - out['present']['area']
    noise = math.hypot(out['past']['jitter']['sd'],
                       out['present']['jitter']['sd'])
    print('CHANGE (past minus present, positive = land lost)')
    print(f'   composite difference : {d:+.2f} km2')
    print(f'   per-scene noise      : +/- {noise:.2f} km2 (1 sd, combined)')
    if noise > 0:
        print(f'   signal / noise       : {abs(d) / noise:.1f}x')
    verdict = ('SEPARABLE from tide' if abs(d) > 3 * noise else
               'NOT separable from tide -- do not present as erosion'
               if abs(d) < noise else 'MARGINAL -- state the uncertainty')
    print(f'   verdict              : {verdict}')
    if d < 0:
        print('   direction            : LAND GAINED, not lost. Check the '
              'threshold orientation before trusting the diff.')
    return out


def diff_masks(past_land, present_land):
    """Split change into loss and gain. Never net them.

    Netting is what defeated the first pass here: this coast erodes along its
    open face while the Dhamra mouth builds a spit, so the AOI total nearly
    cancels and reports ~0 change on a coast that is visibly moving. Loss and
    gain are different physical processes and different operational facts --
    land lost is people displaced; land gained at a river mouth is not somewhere
    anyone can be resettled.
    """
    lost = past_land.And(present_land.Not()).rename('lost')
    gained = past_land.Not().And(present_land).rename('gained')
    return lost, gained


def null_test(sensor, region):
    """Diff two composites from the SAME epoch: whatever appears is noise.

    Per-scene standard deviation answers the wrong question -- it describes
    single scenes, while the deliverable compares composites. This splits the
    present window in half, composites each, and diffs them. Any 'loss' it
    finds is tide, sensor and classification noise, because no erosion happened
    between November and March.
    """
    s = SENSORS[sensor]
    start, end = s['epochs']['present']
    mid = '2026-01-05'
    halves = []
    for a, b in ((start, mid), (mid, end)):
        col = s['clear'](a, b, region)
        n = col.size().getInfo()
        nd = col.map(lambda i: s['ndwi'](i)).median().rename('ndwi')
        halves.append((land_mask(nd), n))
    lost, gained = diff_masks(halves[0][0], halves[1][0])
    return dict(lost=area_km2(lost, region, s['scale']),
                gained=area_km2(gained, region, s['scale']),
                n=[halves[0][1], halves[1][1]])


def change(sensor='s2'):
    """Loss and gain between epochs, against a same-epoch null."""
    ee.Initialize(project=PROJECT)
    region = aoi()
    s = SENSORS[sensor]
    past = epoch(sensor, 'past', region)
    present = epoch(sensor, 'present', region)
    pl, cl = land_mask(past['ndwi']), land_mask(present['ndwi'])
    lost, gained = diff_masks(pl, cl)
    a_lost = area_km2(lost, region, s['scale'])
    a_gain = area_km2(gained, region, s['scale'])
    null = null_test(sensor, region)

    span = f"{past['start'][:7]} -> {present['end'][:7]}"
    print(f'\n{s["label"]}  {span}')
    print(f'   composites      : {past["n"]} past scenes, {present["n"]} present')
    print(f'   land LOST       : {a_lost:8.2f} km2')
    print(f'   land GAINED     : {a_gain:8.2f} km2')
    print(f'   net             : {a_lost - a_gain:+8.2f} km2   '
          f'(the number that hides the story)')
    print(f'   null test       : same-epoch diff of {null["n"][0]}v{null["n"][1]}'
          f' scenes gives lost {null["lost"]:.2f}, gained {null["gained"]:.2f} km2')
    if null['lost'] > 0:
        print(f'   loss / null     : {a_lost / null["lost"]:.1f}x')
    verdict = ('REAL -- well above the same-epoch null'
               if a_lost > 3 * null['lost'] else
               'MARGINAL -- state the uncertainty' if a_lost > null['lost']
               else 'NOT SEPARABLE from noise')
    print(f'   verdict         : {verdict}')

    base = f'{OUT}/{sensor}-change'
    fetch(present['rgb'].visualize(min=0.0, max=s['rgb_max'])
          .blend(gained.selfMask().visualize(palette=['3aa3ff']))
          .blend(lost.selfMask().visualize(palette=['ff2d20'])),
          region, f'{base}.png')
    print(f'   wrote           : {base}.png  (red = lost, blue = gained)')
    return dict(lost=a_lost, gained=a_gain, null=null)


def report():
    """Both sensors side by side, so the baseline choice is made on numbers."""
    ee.Initialize(project=PROJECT)
    region = aoi()
    for sensor in ('s2', 'landsat'):
        s = SENSORS[sensor]
        span = (s['epochs']['past'][0][:4], s['epochs']['present'][1][:4])
        print(f'\n{"=" * 62}\n{s["label"]}  baseline {span[0]} -> {span[1]}'
              f'  ({int(span[1]) - int(span[0])} years)\n{"=" * 62}')
        review(sensor)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'review'
    if cmd == 'review':
        review(sys.argv[2] if len(sys.argv) > 2 else 's2')
    elif cmd == 'change':
        change(sys.argv[2] if len(sys.argv) > 2 else 's2')
    elif cmd == 'report':
        report()
    else:
        raise SystemExit(f'unknown command {cmd!r}')
