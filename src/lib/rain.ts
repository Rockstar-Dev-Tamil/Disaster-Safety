/* ============================================================================
 * RAIN FIELD, AS A NUMBER RATHER THAN A PICTURE
 *
 * The map already draws rain: eight colour bands, national extent, produced by
 * scripts/fetch-ecmwf.py and scripts/build-era5-rainfield.py. That image is for
 * the eye and cannot be read back -- inverting the palette recovers the band,
 * not the value, and would make a site ranking depend on a colour ramp.
 *
 * scripts/build-rain-grids.py emits the numbers those images were drawn from,
 * cropped per case. Same source, same run, same windows: the field on screen
 * and the field in the score are the same field. That equality is the point.
 * Ranking Wayanad against ERA5 reanalysis while the map showed the ECMWF
 * forecast would rank sites on rain nobody could have known about.
 *
 * WHAT THE RESOLUTION SUPPORTS
 * ----------------------------
 * 0.25 degrees, ~28 km. Measured across the search discs before anything was
 * built on it, because a term that cannot vary cannot rank:
 *
 *     Wayanad,     30 km radius:  9 cells, 3.8-17.8 mm/3h, CV 42%
 *     Kendrapara,  30 km radius:  9 cells, 1.3- 3.8 mm/3h, CV 32%
 *     Wayanad,    100 km radius: 57 cells, 1.7-17.8 mm/3h, CV 36%
 *
 * So it does reorder sites. What it cannot do is resolve a valley or a
 * catchment: one cell spans 28 km, and below roughly a 20 km search radius the
 * disc is a couple of cells and the term goes nearly flat. `spread()` measures
 * exactly that, so the interface can say when the term has stopped
 * discriminating instead of quietly ranking on noise.
 * ==========================================================================*/

export interface RainFrame {
  step: number;
  /** Minutes from run initialisation to the END of this accumulation window. */
  validMinutes: number;
  windowHours: number;
  /** Row-major, row 0 northernmost, width * height entries, mm in the window. */
  mm: number[];
}

export interface RainGrid {
  case: string;
  source: string;
  kind: 'forecast' | 'reanalysis';
  run: string;
  runIst: string;
  stepHours: number;
  cellDeg: number;
  note: string;
  /** Outer cell EDGES: [w, s, e, n]. */
  bounds: [number, number, number, number];
  width: number;
  height: number;
  frames: RainFrame[];
}

/** Rain treated as full scale by the siting factor, mm per 3 h window.
 *
 *  25 mm in three hours sustains to 200 mm/day, which is IMD's "extremely
 *  heavy" category. Above it, one site being wetter than another stops being a
 *  useful distinction -- both are unusable -- so the factor saturates rather
 *  than continuing to separate sites on a difference that no longer matters. */
export const RAIN_FULL_SCALE_MM = 25;

/** Which two frames straddle an instant, and how far between them it sits. */
export function framesAt(grid: RainGrid, minutes: number) {
  const fr = grid.frames;
  if (!fr.length) return null;
  let i = 0;
  while (i < fr.length - 2 && fr[i + 1].validMinutes <= minutes) i++;
  const a = fr[i];
  const b = fr[Math.min(i + 1, fr.length - 1)];
  const span = b.validMinutes - a.validMinutes;
  const f = span > 0 ? Math.max(0, Math.min(1, (minutes - a.validMinutes) / span)) : 0;
  return { a, b, f };
}

/** Bilinear read of one frame at a point, mm.
 *
 *  Bilinear rather than nearest so a site's score does not jump when it
 *  happens to cross a cell edge -- a discontinuity in the ranking that is an
 *  artefact of the grid, not of the weather. It interpolates between cell
 *  CENTRES and adds no information: the field is still 28 km. Outside the grid
 *  it returns null rather than 0, because "no data here" and "no rain here"
 *  are different claims and only one of them is safe to score. */
export function sampleFrame(
  grid: RainGrid,
  frame: RainFrame,
  lon: number,
  lat: number,
): number | null {
  const [w, s, e, n] = grid.bounds;
  const { width, height } = grid;
  if (lon < w || lon > e || lat < s || lat > n) return null;

  const cw = (e - w) / width;
  const ch = (n - s) / height;
  /* Fractional position in cell-centre space. */
  const fx = (lon - w) / cw - 0.5;
  const fy = (n - lat) / ch - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const at = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    return frame.mm[cy * width + cx] ?? 0;
  };

  const v00 = at(x0, y0);
  const v10 = at(x0 + 1, y0);
  const v01 = at(x0, y0 + 1);
  const v11 = at(x0 + 1, y0 + 1);
  return (
    v00 * (1 - tx) * (1 - ty) +
    v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty +
    v11 * tx * ty
  );
}

/** Rain at a point at an instant, interpolated in space and in time. */
export function rainAt(
  grid: RainGrid,
  minutes: number,
  lon: number,
  lat: number,
): number | null {
  const fr = framesAt(grid, minutes);
  if (!fr) return null;
  const a = sampleFrame(grid, fr.a, lon, lat);
  const b = sampleFrame(grid, fr.b, lon, lat);
  if (a === null || b === null) return null;
  return a * (1 - fr.f) + b * fr.f;
}

/** A sampler bound to one instant, for handing to the zone derivation. */
export function samplerAt(
  grid: RainGrid | null,
  minutes: number,
): ((lon: number, lat: number) => number | null) | null {
  if (!grid) return null;
  return (lon, lat) => rainAt(grid, minutes, lon, lat);
}

export interface RainSpread {
  cells: number;
  min: number;
  max: number;
  mean: number;
  /** Coefficient of variation, per cent. Zero means the term cannot rank. */
  cv: number;
}

/** How much the field actually varies across the search disc.
 *
 *  Reported to the officer rather than assumed, because whether a rain term
 *  can discriminate at all depends on the radius they chose: at 100 km the
 *  disc holds ~57 cells, at 15 km it holds barely one and the term is
 *  constant. A weight applied to a constant is not a criterion. */
export function spread(
  grid: RainGrid | null,
  minutes: number,
  origin: [number, number],
  radiusKm: number,
): RainSpread | null {
  if (!grid) return null;
  const fr = framesAt(grid, minutes);
  if (!fr) return null;
  const [w, s, e, n] = grid.bounds;
  const cw = (e - w) / grid.width;
  const ch = (n - s) / grid.height;
  const vals: number[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const lon = w + (x + 0.5) * cw;
      const lat = n - (y + 0.5) * ch;
      const dLat = (lat - origin[1]) * 111.32;
      const dLon =
        (lon - origin[0]) * 111.32 * Math.cos((origin[1] * Math.PI) / 180);
      if (Math.hypot(dLat, dLon) > radiusKm) continue;
      const a = fr.a.mm[y * grid.width + x] ?? 0;
      const b = fr.b.mm[y * grid.width + x] ?? 0;
      vals.push(a * (1 - fr.f) + b * fr.f);
    }
  }
  if (!vals.length) return null;
  const mean = vals.reduce((t, v) => t + v, 0) / vals.length;
  const sd =
    vals.length > 1
      ? Math.sqrt(
          vals.reduce((t, v) => t + (v - mean) ** 2, 0) / (vals.length - 1),
        )
      : 0;
  return {
    cells: vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    mean,
    cv: mean > 0.05 ? (sd / mean) * 100 : 0,
  };
}

/** Load a case's grid. Null when the case has none, which is not an error. */
export async function loadRainGrid(url: string | undefined): Promise<RainGrid | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as RainGrid;
  } catch {
    return null;
  }
}
