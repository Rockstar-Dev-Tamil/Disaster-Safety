"""
Build the Module 4 (long-term resettlement) data layers.

Produces, co-registered with the existing 100 m analysis grid:

  protected.png        rasterised protected areas and nature reserves
                       -> a hard exclusion: Wildlife Protection Act 1972 and
                          Forest (Conservation) Act 1980 make these
                          unobtainable on any resettlement timeline
  taluks.geojson       sub-district boundaries, for "same administrative unit"
                       continuity (Cernea: community disarticulation)
  amenities.json       places of worship, burial grounds, common land
                       -> RFCTLARR Third Schedule items 5, 12, 21

host-population.json is fetched separately from Wikidata.
"""
import json
import math
import os
import struct
import zlib

# Grid must match build-terrain.py exactly.
W, S, E, N = 75.55, 11.20, 76.65, 12.15
CELL_M = 100.0
SP = os.environ.get('SCRATCH', '.')
OUT = 'public/terrain'


def grid_shape():
    mid = math.radians((S + N) / 2)
    return (int(round((N - S) * 111320.0 / CELL_M)),
            int(round((E - W) * 111320.0 * math.cos(mid) / CELL_M)))


H, WIDTH = grid_shape()
LATS = [N - (N - S) * y / (H - 1) for y in range(H)]


def write_png_gray(path, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', WIDTH, H, 8, 0, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    return os.path.getsize(path)


def load(name):
    p = os.path.join(SP, name)
    if not os.path.exists(p):
        return {'elements': []}
    return json.load(open(p, encoding='utf-8'))


def rings_of(el):
    """Outer rings for a way or a multipolygon relation.

    Relation members arrive as separate ways that must be chained end-to-end;
    OSM does not guarantee they are ordered or consistently wound.
    """
    if el.get('type') == 'way':
        g = el.get('geometry') or []
        return [[(p['lon'], p['lat']) for p in g]] if len(g) >= 4 else []

    segs = []
    for m in el.get('members', []):
        if m.get('type') != 'way' or m.get('role') not in ('outer', ''):
            continue
        g = m.get('geometry') or []
        if len(g) >= 2:
            segs.append([(p['lon'], p['lat']) for p in g])

    rings, guard = [], 0
    while segs and guard < 4000:
        guard += 1
        cur = segs.pop(0)
        joined = True
        while joined and cur[0] != cur[-1]:
            joined = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]; segs.pop(i); joined = True; break
                if s[-1] == cur[-1]:
                    cur += s[::-1][1:]; segs.pop(i); joined = True; break
        if len(cur) >= 4:
            rings.append(cur)
    return rings


def burn(rings, grid, value):
    """Scanline fill onto the analysis grid."""
    for ring in rings:
        ys = [p[1] for p in ring]
        xs = [p[0] for p in ring]
        if max(xs) < W or min(xs) > E or max(ys) < S or min(ys) > N:
            continue
        r0 = max(0, int((N - max(ys)) / (N - S) * (H - 1)))
        r1 = min(H - 1, int((N - min(ys)) / (N - S) * (H - 1)))
        for r in range(r0, r1 + 1):
            lat = LATS[r]
            xints = []
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                if (y1 > lat) != (y2 > lat):
                    xints.append(x1 + (lat - y1) / (y2 - y1) * (x2 - x1))
            xints.sort()
            for a, b in zip(xints[0::2], xints[1::2]):
                ca = max(0, int((a - W) / (E - W) * (WIDTH - 1)))
                cb = min(WIDTH - 1, int((b - W) / (E - W) * (WIDTH - 1)))
                for c in range(ca, cb + 1):
                    grid[r][c] = value


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f'grid {WIDTH} x {H} at {CELL_M:.0f} m')

    # ---- protected areas -------------------------------------------------
    grid = [bytearray(WIDTH) for _ in range(H)]
    prot = load('protected.json')
    named = []
    for el in prot.get('elements', []):
        rings = rings_of(el)
        if not rings:
            continue
        burn(rings, grid, 255)
        nm = el.get('tags', {}).get('name')
        if nm:
            named.append(nm)
    cells = sum(1 for r in grid for v in r if v)
    b = write_png_gray(f'{OUT}/protected.png', grid)
    print(f'  protected: {cells:,} cells ({cells * (CELL_M**2) / 1e6:.0f} km2), '
          f'{b/1024:.0f} KB')
    for n in sorted(set(named))[:8]:
        print(f'     {n}')

    # ---- taluk boundaries ------------------------------------------------
    feats = []
    for el in load('taluks.json').get('elements', []):
        rings = rings_of(el)
        if not rings:
            continue
        nm = el.get('tags', {}).get('name')
        coords = [[[round(x, 5), round(y, 5)] for x, y in r] for r in rings]
        feats.append({
            'type': 'Feature',
            'properties': {'name': nm, 'level': el.get('tags', {}).get('admin_level')},
            'geometry': {'type': 'MultiPolygon', 'coordinates': [[c] for c in coords]},
        })
    json.dump({'type': 'FeatureCollection', 'features': feats},
              open(f'{OUT}/taluks.geojson', 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'  taluks: {len(feats)} boundaries '
          f'({os.path.getsize(f"{OUT}/taluks.geojson")/1024:.0f} KB)')

    # ---- Third Schedule amenity points -----------------------------------
    amen = {'worship': [], 'burial': [], 'common': []}
    for src, keys in [('poi_worship.json', None), ('poi_common.json', None)]:
        for el in load(src).get('elements', []):
            t = el.get('tags', {})
            lat = el.get('lat') or (el.get('center') or {}).get('lat')
            lon = el.get('lon') or (el.get('center') or {}).get('lon')
            if lat is None or lon is None:
                continue
            rec = {'name': t.get('name'), 'lat': round(lat, 5), 'lon': round(lon, 5)}
            if t.get('amenity') == 'place_of_worship':
                amen['worship'].append(rec)
            elif t.get('amenity') == 'grave_yard' or t.get('landuse') == 'cemetery':
                amen['burial'].append(rec)
            elif t.get('landuse') in ('grass', 'meadow', 'village_green'):
                amen['common'].append(rec)
    json.dump(amen, open(f'{OUT}/amenities.json', 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'  amenities: ' + ', '.join(f'{k} {len(v)}' for k, v in amen.items())
          + f' ({os.path.getsize(f"{OUT}/amenities.json")/1024:.0f} KB)')

    # ---- register in the manifest ---------------------------------------
    mpath = f'{OUT}/manifest.json'
    m = json.load(open(mpath, encoding='utf-8'))
    m['layers']['protected'] = {'file': '/terrain/protected.png', 'scale': 255,
                                'classes': {'protected': 255}, 'bytes': b}
    json.dump(m, open(mpath, 'w', encoding='utf-8'), indent=1)
    print('  manifest updated')


if __name__ == '__main__':
    main()
