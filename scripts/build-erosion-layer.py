"""
Shoreline change as a map overlay, for any site.

    python scripts/build-erosion-layer.py               # every site
    python scripts/build-erosion-layer.py ghoramara     # one
    python scripts/build-erosion-layer.py ghoramara --review   # stats only

Generalises what scripts/export-satabhaya-layer.py did for one place. The
analysis lives in scripts/satabhaya-ndwi.py and is imported rather than copied,
so both sites are measured by exactly the same code -- including the null test,
which is the part that decides whether a result may be shown at all.

Writes public/layers/erosion-<site>.geojson: polygons of land that stood above
water in the earlier dry season and is water now, and the converse.

WHY THE TWO CLASSES ARE NEVER NETTED
------------------------------------
Deltas erode and accrete at the same time. Netting them reported +3.6 km2 at
Satabhaya on a coast that had lost 8 -- the gain was a spit building at a river
mouth, which is not ground anyone can be resettled onto. Loss and gain are
different operational facts and are carried separately.

EVERY SITE MUST PASS THE NULL TEST
----------------------------------
Splitting the recent window in half and differencing the two composites finds
whatever tide, sensor and classification noise produce when no erosion can have
happened. A site whose measured loss is not clearly above its own null does not
get a layer, and the run says so instead of shipping one.
"""
import importlib.util
import io
import json
import os
import sys

import ee

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    'sat', os.path.join(HERE, 'satabhaya-ndwi.py'))
sat = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sat)

#: Defaults; a site may override both. At 30 m one misclassified pixel is
#: 900 m2 and a raw vectorisation is thousands of those through the estuaries.
MIN_AREA_M2 = 20000

#: Douglas-Peucker tolerance, m. Half a pixel: takes the staircase off a raster
#: boundary without moving the line anywhere a reader could see.
SIMPLIFY_M = 15

SENSOR = 'landsat'

SITES = {
    # Kendrapara, Odisha. The village the sea took: seven hamlets lost, 571
    # families resettled at Bagapatia in 2018.
    'satabhaya': dict(
        box=[86.85, 20.55, 87.05, 20.75],
        label='Satabhaya, Kendrapara, Odisha',
        note='Seven hamlets lost; 571 families resettled at Bagapatia, 2018.',
    ),
    # South 24 Parganas, West Bengal. Ghoramara has lost roughly three quarters
    # of its area to erosion and most of its people have already left for Sagar
    # Island; the box holds both, because the destination is as much a part of
    # this story as the origin.
    'ghoramara': dict(
        box=[87.95, 21.50, 88.40, 22.05],
        # Coarser than Satabhaya, and it has to be. This box is the Hooghly
        # mouth: braided channels and tidal creeks produce a vectorisation an
        # order of magnitude more complex, 1.36 MB at the default settings,
        # which is not an overlay anyone can pan. 5 ha and one pixel of
        # simplification bring it to something servable. The cost is printed
        # on every run rather than absorbed quietly.
        minAreaM2=50000, simplifyM=45,
        label='Ghoramara and Sagar Island, South 24 Parganas, West Bengal',
        note='Island reduced to about a quarter of its area; residents moving '
             'to Sagar Island.',
    ),
}


def vectorise(mask, label, region, scale, min_area, simplify):
    fc = mask.selfMask().reduceToVectors(
        geometry=region, scale=scale, geometryType='polygon',
        eightConnected=False, labelProperty='v', maxPixels=1e10)

    def prep(f):
        f = ee.Feature(f).simplify(simplify)
        return f.set('change', label, 'areaM2', f.area(1))

    fc = fc.map(prep)
    return fc, fc.filter(ee.Filter.gte('areaM2', min_area))


def run(site, review_only=False):
    cfg = SITES[site]
    sat.AOI_BOX = cfg['box']                 # aoi() reads this at call time
    region = sat.aoi()
    s = sat.SENSORS[SENSOR]

    print(f'\n{"=" * 66}\n{site}: {cfg["label"]}\n  box {cfg["box"]}\n{"=" * 66}')
    past = sat.epoch(SENSOR, 'past', region)
    present = sat.epoch(SENSOR, 'present', region)
    print(f'  past    {past["start"][:7]}..{past["end"][:7]}  '
          f'{past["n"]} clear full-coverage scenes')
    print(f'  present {present["start"][:7]}..{present["end"][:7]}  '
          f'{present["n"]} scenes')

    pl = sat.land_mask(past['ndwi'])
    cl = sat.land_mask(present['ndwi'])
    lost, gained = sat.diff_masks(pl, cl)
    a_lost = sat.area_km2(lost, region, s['scale'])
    a_gain = sat.area_km2(gained, region, s['scale'])
    null = sat.null_test(SENSOR, region)

    ratio = a_lost / null['lost'] if null['lost'] > 0 else float('inf')
    print(f'  land LOST   {a_lost:8.2f} km2')
    print(f'  land GAINED {a_gain:8.2f} km2')
    print(f'  net         {a_lost - a_gain:+8.2f} km2  <- the number that hides it')
    print(f'  null test   {null["lost"]:8.2f} km2 apparent loss, same epoch '
          f'({null["n"][0]}v{null["n"][1]} scenes)')
    print(f'  loss / null {ratio:8.1f}x')

    if ratio < 3:
        print('  VERDICT: NOT separable from noise -- no layer written.')
        return None
    print('  VERDICT: real, well above the same-epoch null.')
    if review_only:
        return None

    feats = []
    for mask, label in ((lost, 'LOST'), (gained, 'GAINED')):
        allf, kept = vectorise(
            mask, label, region, s['scale'],
            cfg.get('minAreaM2', MIN_AREA_M2), cfg.get('simplifyM', SIMPLIFY_M))
        a_all = allf.aggregate_sum('areaM2').getInfo() / 1e6
        a_kept = kept.aggregate_sum('areaM2').getInfo() / 1e6
        drop = a_all - a_kept
        print(f'  {label:7} {allf.size().getInfo():>5} polys -> '
              f'{kept.size().getInfo():>4} kept   {a_kept:6.2f} km2   '
              f'dropped {drop:.2f} ({drop / a_all * 100 if a_all else 0:.1f}%)')
        for f in kept.getInfo()['features']:
            feats.append({
                'type': 'Feature', 'geometry': f['geometry'],
                'properties': {'change': label,
                               'areaHa': round(f['properties']['areaM2'] / 1e4, 1)},
            })

    out = {'type': 'FeatureCollection',
           'features': sorted(feats, key=lambda f: -f['properties']['areaHa'])}
    path = f'public/layers/erosion-{site}.geojson'
    os.makedirs('public/layers', exist_ok=True)
    io.open(path, 'w', encoding='utf-8').write(json.dumps(out))
    print(f'  wrote {path}  {len(feats)} features, '
          f'{os.path.getsize(path) / 1024:.0f} kB')
    return dict(lost=a_lost, gained=a_gain, null=null['lost'], n=len(feats))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    review = '--review' in sys.argv
    ee.Initialize(project=sat.PROJECT)
    for site in (args or list(SITES)):
        if site not in SITES:
            raise SystemExit(f'unknown site {site!r}; have {list(SITES)}')
        run(site, review)
    return 0


if __name__ == '__main__':
    sys.exit(main())
