"""
Land / territory mask for every terrain stack.

OUTPUT  public/terrain*/land.png        255 inside Indian territory, 0 outside
        public/terrain*/manifest.json   layer entry "land"

WHY THIS EXISTS
---------------
Without it the Kendrapara search returned 98.6% of its area as eligible ground,
because most of that area is the Bay of Bengal and the sea passes every test
there is: the DEM has values over water, slope is zero, there is no land use,
and the flood layer classes open ocean as dry at every return period. The
console was proposing relocation sites at sea and reporting them with a score.

Every other exclusion answers "is this ground suitable". This one answers the
question underneath it -- "is this ground" -- and has to run first.

It also settles the international border, which nothing else did. The Majuli
area of interest reaches within a few kilometres of Bangladesh, and a candidate
zone across that line is not a siting error the officer can argue with, it is
one that ends the conversation.

RESOLUTION, HONESTLY
--------------------
The bundled district boundaries are generalised for display at national zoom,
not surveyed coastline. Expect the shore to be right to something like a
kilometre, not to a hundred metres. That is good enough to keep candidate zones
out of the sea and inside the country; it is NOT good enough to adjudicate a
site that sits within a kilometre of the coast or the border, and a zone near
either should be treated as needing a real boundary check.
"""
import json
import os
import struct
import sys
import zlib

import numpy as np
import rasterio.features
from rasterio.transform import from_bounds

BOUNDARY = 'public/geo/india-districts.json'

STACKS = [
    'public/terrain',
    'public/terrain-assam',
    'public/terrain-kendrapara',
]


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


def main():
    if not os.path.exists(BOUNDARY):
        print(f'missing {BOUNDARY}')
        return 1
    gj = json.load(open(BOUNDARY, encoding='utf-8'))
    shapes = [(f['geometry'], 1) for f in gj['features'] if f.get('geometry')]
    print(f'{len(shapes)} district polygons from {BOUNDARY}\n')

    for stack in STACKS:
        mp = os.path.join(stack, 'manifest.json')
        if not os.path.exists(mp):
            print(f'{stack}: no manifest, skipping')
            continue
        m = json.load(open(mp, encoding='utf-8'))

        # Drop entries whose file is not on disk. A manifest and its directory
        # can drift -- an AOI loses its DEM, a raster is rebuilt at a new grid
        # and the old one deleted -- and every stale entry becomes a 404 and a
        # failed load stage for a layer that was never meant to be there.
        stale = [k for k, v in m['layers'].items()
                 if not os.path.exists(os.path.join(
                     'public', v['file'].lstrip('/')))]
        for k in stale:
            del m['layers'][k]
        if stale:
            print(f'{stack}: pruned {", ".join(stale)} (file absent)')

        w, s, e, n = m['bounds']
        width, height = m['width'], m['height']

        # `all_touched` is deliberately off: a cell is land when its CENTRE is
        # inside a district, matching how every other layer is sampled. On with
        # it, a cell clipped by the coastline counts as land and the mask creeps
        # seaward by half a cell all the way round.
        mask = rasterio.features.rasterize(
            shapes,
            out_shape=(height, width),
            transform=from_bounds(w, s, e, n, width, height),
            fill=0,
            default_value=1,
            all_touched=False,
            dtype='uint8',
        )
        land = (mask * 255).astype('uint8')
        b = write_png_gray(os.path.join(stack, 'land.png'), land)
        m['layers']['land'] = {
            'file': f'/{stack.split("public/", 1)[-1]}/land.png',
            'unit': 'mask',
            'scale': 255,
            'bytes': b,
            'source': 'Bundled district boundaries, Government of India depiction',
            'note': 'Generalised for national-zoom display; shore accurate to '
                    'roughly a kilometre, not to the 100 m grid.',
        }
        json.dump(m, open(mp, 'w', encoding='utf-8'), indent=1)
        pct = mask.mean() * 100
        print(f'{stack:<32} {width} x {height}   land {pct:5.1f}%   '
              f'sea/outside {100 - pct:5.1f}%   ({b / 1024:.0f} kB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
