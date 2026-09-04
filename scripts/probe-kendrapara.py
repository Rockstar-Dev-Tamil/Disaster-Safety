"""
Feasibility probe for a Kendrapara (Odisha) terrain stack.

Answers one question before any pipeline work is committed: for this area of
interest, which of the layers the analysis needs can actually be sourced?

Nothing is written. This only counts what comes back.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

# Kanhupur sits at 86.9381 E, 20.6284 N. Box is sized to hold a 30 km
# operation radius with margin, and to land near the Wayanad grid's cell count.
W, S, E, N = 86.55, 20.25, 87.35, 21.00

MIRRORS = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]


def post(query, tries=2):
    last = None
    for mirror in MIRRORS:
        for _ in range(tries):
            try:
                body = urllib.parse.urlencode({'data': query}).encode()
                req = urllib.request.Request(
                    mirror, data=body,
                    headers={'User-Agent': 'sdma-redzone/0.1 (hackathon prototype)'},
                )
                with urllib.request.urlopen(req, timeout=90) as r:
                    return json.loads(r.read().decode())
            except Exception as exc:                             # noqa: BLE001
                last = exc
                time.sleep(4)
    raise RuntimeError(last)


BBOX = f'{S},{W},{N},{E}'

CHECKS = [
    ('coastline',        f'way["natural"="coastline"]({BBOX});'),
    ('protected areas',  f'relation["boundary"="protected_area"]({BBOX});'
                         f'way["boundary"="protected_area"]({BBOX});'),
    ('nature reserve',   f'relation["leisure"="nature_reserve"]({BBOX});'
                         f'way["leisure"="nature_reserve"]({BBOX});'),
    ('mangrove/wetland', f'way["natural"="wetland"]({BBOX});'),
    ('roads tertiary+',  f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary)"]({BBOX});'),
    ('settlements',      f'node["place"~"^(city|town|village)$"]({BBOX});'),
    ('landuse',          f'way["landuse"]({BBOX});'),
    ('water bodies',     f'way["natural"="water"]({BBOX});'),
    ('embankments',      f'way["man_made"="dyke"]({BBOX});way["embankment"="yes"]({BBOX});'),
]


def main():
    print(f'AOI  {W},{S} -> {E},{N}   (Kendrapara, Odisha)\n')
    ok = 0
    for label, body in CHECKS:
        q = f'[out:json][timeout:60];({body});out count;'
        try:
            d = post(q)
            el = d.get('elements', [])
            tags = el[0].get('tags', {}) if el else {}
            total = int(tags.get('total', 0))
            print(f'  {label:<18} {total:>7}')
            if total:
                ok += 1
        except Exception as exc:                                 # noqa: BLE001
            print(f'  {label:<18} FAILED  {str(exc)[:60]}')
        time.sleep(2)

    print(f'\n  {ok}/{len(CHECKS)} layers returned data')
    if ok < len(CHECKS):
        print('  Missing layers degrade coverage; they do not block the build.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
