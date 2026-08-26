"""
Build a routing graph from the cached OSM road ways.

WHY THIS EXISTS SEPARATELY FROM roads.geojson
    The display file kept only coordinates, so junctions could only be guessed
    from coincident endpoints -- unreliable exactly where it matters. The cached
    Overpass responses carry each way's `nodes` array, so real topology is
    available without refetching: a node shared by two ways IS a junction.

OUTPUT
    nodes  [[lon, lat], ...]                       junction and endpoint nodes
    edges  [{a, b, hw, name, m, g}]                a,b are node indices
                                                   g is the polyline between them

Ways are split at every junction, so an edge runs junction-to-junction and can
be blocked, costed and traversed independently.
"""
import json
import math
import os
from collections import Counter

SP = os.environ.get('SCRATCH', '.')
CLASSES = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary'}


def load_ways():
    seen, ways = set(), []
    for n in range(1, 17):
        p = os.path.join(SP, f'osm_roads_t{n:02d}.json')
        if not os.path.exists(p):
            continue
        for el in json.load(open(p, encoding='utf-8')).get('elements', []):
            if el.get('type') != 'way' or el.get('id') in seen:
                continue
            if el.get('tags', {}).get('highway') not in CLASSES:
                continue
            if len(el.get('nodes', [])) != len(el.get('geometry', [])):
                continue
            seen.add(el['id'])
            ways.append(el)
    return ways


def haversine_m(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def main():
    ways = load_ways()
    print(f'{len(ways):,} routable ways')

    # A node touched by more than one way is a junction; way endpoints always are.
    use = Counter()
    for w in ways:
        for nd in w['nodes']:
            use[nd] += 1
    junction = set()
    for w in ways:
        junction.add(w['nodes'][0])
        junction.add(w['nodes'][-1])
    for nd, c in use.items():
        if c > 1:
            junction.add(nd)
    print(f'{len(junction):,} junction nodes of {len(use):,} total')

    node_index, node_coords = {}, []

    def idx_of(osm_id, lon, lat):
        if osm_id not in node_index:
            node_index[osm_id] = len(node_coords)
            node_coords.append([round(lon, 5), round(lat, 5)])
        return node_index[osm_id]

    edges = []
    for w in ways:
        tags = w.get('tags', {})
        hw = tags['highway']
        name = tags.get('name') or tags.get('ref')
        nds, geo = w['nodes'], w['geometry']

        start = 0
        for i in range(1, len(nds)):
            if nds[i] not in junction and i != len(nds) - 1:
                continue
            seg = geo[start:i + 1]
            if len(seg) < 2:
                start = i
                continue
            coords = [[round(p['lon'], 5), round(p['lat'], 5)] for p in seg]
            ded = [c for k, c in enumerate(coords) if k == 0 or c != coords[k - 1]]
            if len(ded) < 2:
                start = i
                continue
            m = sum(haversine_m(ded[k], ded[k + 1]) for k in range(len(ded) - 1))
            if m < 1:
                start = i
                continue
            a = idx_of(nds[start], geo[start]['lon'], geo[start]['lat'])
            b = idx_of(nds[i], geo[i]['lon'], geo[i]['lat'])
            if a != b:
                edges.append({
                    'a': a, 'b': b, 'hw': hw,
                    'name': name, 'm': round(m), 'g': ded,
                })
            start = i

    out = {'nodes': node_coords, 'edges': edges}
    dest = 'public/terrain/road-graph.json'
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))

    deg = Counter()
    for e in edges:
        deg[e['a']] += 1
        deg[e['b']] += 1
    dead = sum(1 for v in deg.values() if v == 1)
    byclass = Counter(e['hw'] for e in edges)
    print(f'{len(edges):,} edges, {len(node_coords):,} nodes '
          f'-> {dest} ({os.path.getsize(dest) / 1024:.0f} KB)')
    print(f'  mean degree {2 * len(edges) / max(1, len(node_coords)):.2f}, '
          f'{dead:,} dead ends')
    print('  by class:', dict(byclass))


if __name__ == '__main__':
    main()
