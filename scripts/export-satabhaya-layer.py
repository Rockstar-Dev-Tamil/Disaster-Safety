"""
Vectorise the Satabhaya shoreline change into a map overlay.

    python scripts/export-satabhaya-layer.py

Writes public/layers/satabhaya-shoreline-change.geojson: polygons of land that
was above water in the 1990-91 dry season and is water now, and the converse.
The analysis behind it lives in scripts/satabhaya-ndwi.py -- this file only
turns the two raster masks into something the overlay registry can draw.

WHY POLYGONS AND NOT A RASTER
-----------------------------
The change is a thin band -- a few hundred metres across a coast tens of
kilometres long. As tiles that is mostly empty pyramid; as vectors it is a few
hundred kilobytes that stay crisp at every zoom, which matters because the
officer reads this at the scale of a village.

WHAT IS FILTERED, AND WHAT THAT COSTS
-------------------------------------
Polygons below MIN_AREA_M2 are dropped. At 30 m a single misclassified pixel is
900 m2, and a raw vectorisation is thousands of those scattered through the
estuary and the aquaculture ponds. The threshold is a legibility decision, not
a statistical one, so the run prints how much real area it discards -- if that
number is ever a large share of the total, the filter is lying and should move.
"""
import io
import json
import os

import ee

import importlib.util as _iu

_spec = _iu.spec_from_file_location('sat', os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'satabhaya-ndwi.py'))
sat = _iu.module_from_spec(_spec)
_spec.loader.exec_module(sat)

OUT = 'public/layers/satabhaya-shoreline-change.geojson'

#: Smallest polygon kept, m2. ~22 Landsat pixels.
MIN_AREA_M2 = 20000

#: Douglas-Peucker tolerance, m. Half a pixel: removes the staircase a raster
#: boundary leaves without moving the line anywhere a reader could see.
SIMPLIFY_M = 15

SENSOR = 'landsat'


def vectorise(mask, label, region, scale):
    """Polygons of one change class, speckle removed and edges de-staircased."""
    fc = mask.selfMask().reduceToVectors(
        geometry=region, scale=scale, geometryType='polygon',
        eightConnected=False, labelProperty='v', maxPixels=1e10)

    def prep(f):
        f = ee.Feature(f).simplify(SIMPLIFY_M)
        return f.set('change', label, 'areaM2', f.area(1))

    fc = fc.map(prep)
    kept = fc.filter(ee.Filter.gte('areaM2', MIN_AREA_M2))
    return fc, kept


def main():
    ee.Initialize(project=sat.PROJECT)
    region = sat.aoi()
    s = sat.SENSORS[SENSOR]
    scale = s['scale']

    past = sat.epoch(SENSOR, 'past', region)
    present = sat.epoch(SENSOR, 'present', region)
    lost, gained = sat.diff_masks(sat.land_mask(past['ndwi']),
                                 sat.land_mask(present['ndwi']))

    feats = []
    print(f'{s["label"]}  {past["start"][:7]} -> {present["end"][:7]}')
    for mask, label in ((lost, 'LOST'), (gained, 'GAINED')):
        allf, kept = vectorise(mask, label, region, scale)
        n_all = allf.size().getInfo()
        n_kept = kept.size().getInfo()
        a_all = allf.aggregate_sum('areaM2').getInfo() / 1e6
        a_kept = kept.aggregate_sum('areaM2').getInfo() / 1e6
        drop = a_all - a_kept
        print(f'  {label:7} {n_all:>5} polygons -> {n_kept:>4} kept   '
              f'{a_all:6.2f} km2 -> {a_kept:6.2f} km2   '
              f'dropped {drop:.2f} km2 ({drop / a_all * 100:.1f}%)')
        gj = kept.getInfo()
        for f in gj['features']:
            feats.append({
                'type': 'Feature',
                'geometry': f['geometry'],
                'properties': {
                    'change': label,
                    'areaHa': round(f['properties']['areaM2'] / 1e4, 1),
                },
            })

    out = {
        'type': 'FeatureCollection',
        'features': sorted(feats, key=lambda f: -f['properties']['areaHa']),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, 'w', encoding='utf-8').write(json.dumps(out))
    kb = os.path.getsize(OUT) / 1024
    print(f'\nwrote {OUT}  {len(feats)} features, {kb:.0f} kB')
    for label in ('LOST', 'GAINED'):
        sel = [f for f in feats if f['properties']['change'] == label]
        tot = sum(f['properties']['areaHa'] for f in sel)
        big = max((f['properties']['areaHa'] for f in sel), default=0)
        print(f'  {label:7} {len(sel):>4} polygons  {tot / 100:6.2f} km2  '
              f'largest {big:.0f} ha')


if __name__ == '__main__':
    main()
