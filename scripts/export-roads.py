"""Export the cached OSM road ways as GeoJSON for display on the zoomed map.

The rasterised distance-to-road surface answers "how far to a road"; this is
the linework you actually see when the map drops to road level.
"""
import json, os

SP = os.environ.get('SCRATCH', '.')

# Output directory follows the same TERRAIN_AOI variable as build-terrain.py, so
# the road layers cannot end up in a different AOI's stack than the rasters they
# describe.
AOI_OUT = {'wayanad': 'public/terrain', 'majuli': 'public/terrain-assam',
           'kendrapara': 'public/terrain-kendrapara'}
OUT_DIR = AOI_OUT[os.environ.get('TERRAIN_AOI', 'wayanad')]

CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']

elements = []
seen = set()
for n in range(1, 5):
    p = os.path.join(SP, f'osm_roads_t{n:02d}.json')
    if not os.path.exists(p):
        continue
    for el in json.load(open(p, encoding='utf-8')).get('elements', []):
        if el.get('id') in seen:
            continue
        seen.add(el.get('id'))
        elements.append(el)

feats = []
counts = {}
for el in elements:
    g = el.get('geometry') or []
    if len(g) < 2:
        continue
    hw = el.get('tags', {}).get('highway')
    if hw not in CLASSES:
        continue
    counts[hw] = counts.get(hw, 0) + 1
    coords = [[round(p['lon'], 5), round(p['lat'], 5)] for p in g]
    # drop consecutive duplicates after rounding
    ded = [c for i, c in enumerate(coords) if i == 0 or c != coords[i - 1]]
    if len(ded) < 2:
        continue
    feats.append({
        'type': 'Feature',
        'properties': {
            'hw': hw,
            'name': el.get('tags', {}).get('name'),
            'ref': el.get('tags', {}).get('ref'),
        },
        'geometry': {'type': 'LineString', 'coordinates': ded},
    })

out = {'type': 'FeatureCollection', 'features': feats}
dest = f'{OUT_DIR}/roads.geojson'
with open(dest, 'w', encoding='utf-8') as f:
    json.dump(out, f, separators=(',', ':'))
print(f'{len(feats)} ways -> {dest} ({os.path.getsize(dest)/1024:.0f} KB)')
print('by class:', counts)
