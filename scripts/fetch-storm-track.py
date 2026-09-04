"""
Hourly storm centre positions for an event, from the ERA5 pressure field.

    python scripts/fetch-storm-track.py --event fani

OUTPUT  data/era5/<event>-track.json

WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
----------------------------------------
These are OBSERVED positions. They are used in exactly two ways downstream, and
the distinction between them is the whole point:

  ALLOWED    positions up to the moment a cone is issued, to establish where the
             storm is and how it has been moving. A forecaster has this.
  FORBIDDEN  positions after that moment, to place the cone. A forecaster does
             NOT have this, and a cone centred on the track that actually
             happened would put the truth dead centre every time -- which is
             never true of a real forecast and would make the cone look far
             better than any cone is.

Positions after the issue time are carried in the same file only so the cone can
be VERIFIED against them afterwards: did the storm stay inside? That is a
result, not an input.

METHOD
------
Centre is the pressure-weighted centroid of every cell within 1 hPa of the
minimum mean sea level pressure inside the search box. Taking the single minimum
cell would quantise the track to the 0.25 degree grid and make the motion vector
jump around; averaging the low-pressure core gives a centre that moves smoothly
enough to differentiate.
"""
import argparse
import json
import math
import os
import sys

PROJECT = os.environ.get('EE_PROJECT', 'sihrivererosion')
OUT_DIR = 'data/era5'

EVENTS = {
    'fani': {
        # Generous: Fani ran up the Bay of Bengal and crossed the coast near
        # Puri. A tight box would clip the centre once it moved inland.
        'box': [80.0, 12.0, 92.0, 26.0],
        'start': '2019-05-01',
        'end': '2019-05-05',
        'label': 'Cyclone Fani',
    },
}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--event', default='fani', choices=sorted(EVENTS))
    a = ap.parse_args()
    cfg = EVENTS[a.event]

    import ee
    try:
        ee.Initialize(project=PROJECT)
    except Exception as exc:                                   # noqa: BLE001
        print(f'Earth Engine not ready: {str(exc)[:160]}')
        return 2

    box = ee.Geometry.Rectangle(cfg['box'])
    coll = (ee.ImageCollection('ECMWF/ERA5/HOURLY')
            .filterDate(cfg['start'], cfg['end'])
            .select('mean_sea_level_pressure'))
    n = coll.size().getInfo()
    print(f'{cfg["label"]}: {n} hourly fields over {cfg["box"]}')

    def centre(img):
        mslp = img.select('mean_sea_level_pressure')
        lo = ee.Number(mslp.reduceRegion(
            ee.Reducer.min(), box, 27830, maxPixels=1e9,
        ).get('mean_sea_level_pressure'))
        core = mslp.lte(lo.add(100))          # within 1 hPa of the minimum
        ll = ee.Image.pixelLonLat().updateMask(core)
        pos = ll.reduceRegion(ee.Reducer.mean(), box, 27830, maxPixels=1e9)
        return ee.Feature(None, {
            't': img.date().format('YYYY-MM-dd HH:mm'),
            'lon': pos.get('longitude'),
            'lat': pos.get('latitude'),
            'mslpHpa': lo.divide(100),
        })

    rows = coll.map(centre).getInfo()['features']
    track = []
    for f in rows:
        p = f['properties']
        if p.get('lon') is None:
            continue
        track.append({
            't': p['t'],
            'lon': round(p['lon'], 3),
            'lat': round(p['lat'], 3),
            'mslpHpa': round(p['mslpHpa'], 1),
        })
    track.sort(key=lambda r: r['t'])

    # Speed and heading between consecutive fixes, for the motion vector a cone
    # is extrapolated along.
    for i, r in enumerate(track):
        if i == 0:
            r['speedKmh'] = None
            r['headingDeg'] = None
            continue
        a0, b0 = track[i - 1], r
        dlat = b0['lat'] - a0['lat']
        dlon = (b0['lon'] - a0['lon']) * math.cos(math.radians((a0['lat'] + b0['lat']) / 2))
        km = math.hypot(dlat, dlon) * 111.32
        r['speedKmh'] = round(km, 1)
        r['headingDeg'] = round(math.degrees(math.atan2(dlon, dlat)) % 360, 0)

    os.makedirs(OUT_DIR, exist_ok=True)
    dest = os.path.join(OUT_DIR, f'{a.event}-track.json')
    json.dump({'event': cfg['label'],
               'note': 'OBSERVED positions. Legitimate as cone input only up to '
                       'the issue time; later positions are for verification.',
               'track': track},
              open(dest, 'w', encoding='utf-8'), indent=1)

    deep = min(track, key=lambda r: r['mslpHpa'])
    print(f'  deepest {deep["mslpHpa"]} hPa at {deep["t"]}Z  '
          f'({deep["lat"]:.2f} N, {deep["lon"]:.2f} E)')
    print(f'  -> {dest}  ({len(track)} fixes)\n')
    print('  6-hourly, UTC:')
    for r in track[::6]:
        sp = f'{r["speedKmh"]:5.1f} km/h  {r["headingDeg"]:3.0f}deg' \
            if r['speedKmh'] is not None else '     -'
        print(f'    {r["t"]}   {r["lat"]:6.2f} N {r["lon"]:6.2f} E   '
              f'{r["mslpHpa"]:6.1f} hPa   {sp}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
