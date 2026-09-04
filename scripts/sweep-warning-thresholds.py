"""
Sweep a scale factor on the IMD rainfall categories and report what each does.

    python scripts/sweep-warning-thresholds.py

WHY A SCALE FACTOR AT ALL
-------------------------
IMD's 24 h categories are gauge-calibrated. IMERG under-reads orographic
extremes in the Western Ghats by roughly a factor of three, so applying 204.5 mm
unscaled produces ORANGE for Wayanad on the day around 400 people died. A single
multiplier on the boundaries is the cheapest correction that moves the whole
scale in the right direction.

WHAT IT IS NOT
--------------
It is not a derivation. The principled version fits return levels to each
district's OWN IMERG record, so the satellite is compared against itself and the
bias cancels -- which is what scripts/derive-thresholds.py already does for the
Wayanad cell, and what would have to be done 726 times to do this properly. A
single national multiplier cannot fix a bias that varies spatially: it will
over-warn the plains at whatever setting makes the Ghats read correctly.

This script exists so the multiplier is CHOSEN AGAINST EVIDENCE rather than
guessed, and so the number that ends up in the layer has a table behind it.
Reads the cached rasters from the last build rather than re-querying.
"""
import json
import os
import sys

import numpy as np
import rasterio
import rasterio.features

DISTRICTS = 'public/geo/india-districts.json'
SCRATCH = os.environ.get('SCRATCH', '.')

BASE = [(204.5, 'RED'), (115.6, 'ORANGE'), (64.5, 'YELLOW')]
FACTORS = [1.0, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]

CASES = {
    'wayanad': 'Wayanad debris flow, 29-30 Jul 2024',
    'kendrapara': 'Cyclone Fani, 2-3 May 2019',
    'assam': 'Live window',
}

#: Districts whose outcome we actually know something about, so the table can
#: be read against reality rather than only against itself.
WATCH = {
    'wayanad': [('Wayanad', 'Kerala'), ('Malappuram', 'Kerala')],
    'kendrapara': [('Puri', 'Odisha'), ('Kendrapara', 'Odisha')],
    'assam': [('Kendrapara', 'Odisha'), ('Jorhat', 'Assam')],
}


def district_peaks(case, gj):
    tif = os.path.join(SCRATCH, f'imd24-{case}.tif')
    if not os.path.exists(tif):
        print(f'missing {tif} -- run scripts/build-district-warning.py first')
        sys.exit(1)
    with rasterio.open(tif) as d:
        mm = np.nan_to_num(d.read(1).astype('float32'), nan=0.0)
        tr, h, w = d.transform, d.height, d.width
    out = {}
    for f in gj['features']:
        geom = f.get('geometry')
        if not geom:
            continue
        mask = rasterio.features.rasterize(
            [(geom, 1)], out_shape=(h, w), transform=tr, fill=0,
            default_value=1, all_touched=True, dtype='uint8')
        if mask.any():
            p = f['properties']
            out[(p.get('name'), p.get('state'))] = float(mm[mask == 1].max())
    return out


def classify(mm, factor):
    for lo, code in BASE:
        if mm >= lo * factor:
            return code
    return None


def main():
    gj = json.load(open(DISTRICTS, encoding='utf-8'))
    peaks = {c: district_peaks(c, gj) for c in CASES}
    total = len(next(iter(peaks.values())))
    print(f'{total} districts with coverage\n')

    for case, label in CASES.items():
        pk = peaks[case]
        print(f'=== {case}  {label}')
        print(f'{"factor":>7}{"red thr":>9}{"RED":>6}{"ORG":>6}{"YEL":>6}{"none":>7}   '
              + '  '.join(f'{n}' for n, _ in WATCH[case]))
        for f in FACTORS:
            counts = {'RED': 0, 'ORANGE': 0, 'YELLOW': 0, None: 0}
            for v in pk.values():
                counts[classify(v, f)] += 1
            watched = '  '.join(
                f'{classify(pk.get(k, 0.0), f) or "-":<7}' for k in WATCH[case])
            print(f'{f:>7.2f}{204.5 * f:>9.0f}{counts["RED"]:>6}{counts["ORANGE"]:>6}'
                  f'{counts["YELLOW"]:>6}{counts[None]:>7}   {watched}')
        print()

    print('Reference peaks (mm/24h, IMERG):')
    for case in CASES:
        pk = peaks[case]
        for k in WATCH[case]:
            print(f'  {case:<12} {k[0]:<14} {pk.get(k, float("nan")):6.1f}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
