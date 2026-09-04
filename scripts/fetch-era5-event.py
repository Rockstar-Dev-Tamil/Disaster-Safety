"""
Hourly ERA5 reanalysis at a point, for a named event window, via Earth Engine.

    python scripts/fetch-era5-event.py --event fani

REANALYSIS, NOT FORECAST -- AND THE DISTINCTION MATTERS HERE
------------------------------------------------------------
The ECMWF layer already in this console is a FORECAST: what the model said in
advance, retrieved from the open-data archive, and the timeline says so
explicitly because the whole point is what an officer could have known before
the event.

That archive does not reach Cyclone Fani. It starts somewhere between January
and March 2024; 2019 is far outside it, and no amount of retrying changes that.
ERA5 reaches back to 1940, so it can describe Fani -- but it is reanalysis,
assimilated after the fact. It says what the atmosphere DID, not what anyone
was told it would do. Presenting it as a forecast would misrepresent the one
thing the console is careful about, so whatever consumes this must label it as
hindcast.

WHY WIND AND PRESSURE RATHER THAN RAIN
--------------------------------------
Kendrapara lies about 150 km up-coast from where Fani made landfall. IMERG puts
only ~95 mm there over four days, which is not the story. For a cyclone at that
range the operative hazards are wind and surge, which is why the habitation's
feed carries surge and wave thresholds rather than rainfall ones.
"""
import argparse
import json
import os
import sys

PROJECT = os.environ.get('EE_PROJECT', 'sihrivererosion')
OUT_DIR = 'data/era5'

EVENTS = {
    'fani': {
        # Kanhupur itself. Sampling here needs full ERA5 rather than ERA5-Land:
        # Land masks water, and at 0.1 degrees this coastal cell is water, so
        # Land returns nothing at all here.
        'point': [86.9381, 20.6284],
        'start': '2019-05-01',
        'end': '2019-05-05',
        'label': 'Cyclone Fani, landfall near Puri 03 May 2019 ~08:00 IST',
    },
}

#: ERA5 hourly, NOT ERA5-Land. Land is masked over water, and Kanhupur sits on
#: the coast: at 0.1 degrees its cell is water and returns nothing. Full ERA5
#: also carries the two fields this habitation's thresholds are actually
#: written against -- significant wave height and gust -- which Land does not.
COLLECTION = 'ECMWF/ERA5/HOURLY'
BANDS = [
    'u_component_of_wind_10m',
    'v_component_of_wind_10m',
    'wind_gust_since_previous_post_processing_10m',
    'mean_sea_level_pressure',
    'significant_height_of_combined_wind_waves_and_swell',
    'total_precipitation',
]


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

    pt = ee.Geometry.Point(cfg['point'])
    coll = (ee.ImageCollection(COLLECTION)
            .filterDate(cfg['start'], cfg['end'])
            .select(BANDS))
    n = coll.size().getInfo()
    print(f'{a.event}: {cfg["label"]}')
    print(f'  {n} hourly steps at {cfg["point"]}')

    def sample(img):
        v = img.reduceRegion(ee.Reducer.first(), pt, 5000)
        return ee.Feature(None, v.set('t', img.date().format('YYYY-MM-dd HH:mm')))

    rows = coll.map(sample).getInfo()['features']
    out = []
    for f in rows:
        p = f['properties']
        if p.get('u_component_of_wind_10m') is None:
            continue
        import math
        u, v = p['u_component_of_wind_10m'], p['v_component_of_wind_10m']
        spd = (u * u + v * v) ** 0.5
        gust = p.get('wind_gust_since_previous_post_processing_10m') or 0
        out.append({
            't': p['t'],
            'windKmh': round(spd * 3.6, 1),
            'gustKmh': round(gust * 3.6, 1),
            # Meteorological convention: the direction the wind comes FROM.
            'dirDeg': round((270 - math.degrees(math.atan2(v, u))) % 360, 0),
            'mslpHpa': round(p['mean_sea_level_pressure'] / 100.0, 1),
            'waveM': round(
                p.get('significant_height_of_combined_wind_waves_and_swell') or 0, 2),
            'rainMm': round((p.get('total_precipitation') or 0) * 1000, 2),
        })
    out.sort(key=lambda r: r['t'])
    os.makedirs(OUT_DIR, exist_ok=True)
    dest = os.path.join(OUT_DIR, f'{a.event}-era5.json')
    json.dump({'event': cfg['label'], 'point': cfg['point'],
               'note': 'ERA5 reanalysis, NOT a forecast', 'series': out},
              open(dest, 'w', encoding='utf-8'), indent=1)

    peak = max(out, key=lambda r: r['gustKmh'])
    low = min(out, key=lambda r: r['mslpHpa'])
    wave = max(out, key=lambda r: r['waveM'])
    print(f'  peak gust      {peak["gustKmh"]:.0f} km/h from {peak["dirDeg"]:.0f}deg '
          f'at {peak["t"]} UTC')
    print(f'  min MSLP       {low["mslpHpa"]:.1f} hPa at {low["t"]} UTC')
    print(f'  peak wave Hs   {wave["waveM"]:.2f} m at {wave["t"]} UTC')
    print(f'  -> {dest}  ({len(out)} steps)')

    print('\n  hourly, IST, around landfall:')
    import datetime as dt
    for r in out:
        u = dt.datetime.strptime(r['t'], '%Y-%m-%d %H:%M').replace(
            tzinfo=dt.timezone.utc)
        ist = u + dt.timedelta(hours=5, minutes=30)
        if dt.datetime(2019, 5, 2, 18, tzinfo=None) <= ist.replace(tzinfo=None) \
                <= dt.datetime(2019, 5, 3, 18, tzinfo=None):
            print(f'    {ist:%d %b %H:%M} IST  wind {r["windKmh"]:5.1f}  '
                  f'gust {r["gustKmh"]:5.1f} km/h  {r["dirDeg"]:3.0f}deg  '
                  f'{r["mslpHpa"]:6.1f} hPa  Hs {r["waveM"]:4.2f} m')
    return 0


if __name__ == '__main__':
    sys.exit(main())
