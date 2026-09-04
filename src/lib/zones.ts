/* ============================================================================
 * CANDIDATE ZONE EXTRACTION
 *
 * filter -> cluster -> floor -> fit -> rank
 *
 * A zone is drawn as an ELLIPSE, not a polygon, and that is deliberate. The
 * hazard sheets are 1:50,000 and the grid is 100 m, so nothing here supports a
 * parcel boundary. The ellipse is the second moment of the eligible cells in a
 * cluster -- it says "eligible ground clusters here, roughly this big, roughly
 * this shape, go and look". Drawing a crisp polygon would claim a precision
 * the inputs do not have.
 *
 * Every exclusion records WHICH rule removed it. An officer can argue with
 * "slope 6.2 deg exceeds 5 deg"; they cannot argue with a grey pixel.
 * ==========================================================================*/

import type { TerrainManifest, TerrainStack } from './terrain';
import { haversineKm } from './terrain';

/* ----------------------------------------------------------- exclusions --- */

export const EXCLUSION = {
  NONE: 0,
  OUTSIDE_RADIUS: 1,
  LANDSLIDE: 2,
  FLOOD: 3,
  SLOPE: 4,
  DRAINAGE: 5,
  NO_DATA: 6,
  SPECKLE: 7,
  BUILT_UP: 8,
  RESTRICTED: 9,
  PADDY: 10,
  FOREST: 11,
  PROTECTED: 12,
  FLOOD_RP: 15,
  HAND: 13,
  HAND_UNRESOLVED: 14,
} as const;

export type ExclusionCode = (typeof EXCLUSION)[keyof typeof EXCLUSION];

export const EXCLUSION_LABEL: Record<number, string> = {
  [EXCLUSION.NONE]: 'Eligible',
  [EXCLUSION.OUTSIDE_RADIUS]: 'Outside operation radius',
  [EXCLUSION.LANDSLIDE]: 'Landslide hazard, Medium or High',
  [EXCLUSION.FLOOD]: 'Flood plain or waterbody',
  [EXCLUSION.SLOPE]: 'Slope exceeds camp gradient limit',
  [EXCLUSION.DRAINAGE]: 'Too close to local drainage level',
  [EXCLUSION.NO_DATA]: 'No terrain data',
  [EXCLUSION.SPECKLE]: 'Isolated cells, not contiguous buildable ground',
  [EXCLUSION.BUILT_UP]: 'Built-up — residential, commercial or industrial',
  [EXCLUSION.RESTRICTED]: 'Restricted use — quarry, cemetery, military',
  [EXCLUSION.PADDY]: 'Paddy — seasonally waterlogged',
  [EXCLUSION.FOREST]: 'Forest — diversion under Forest (Conservation) Act 1980',
  [EXCLUSION.FLOOD_RP]: 'Inside the design flood (Aqueduct return period)',
  [EXCLUSION.HAND]: 'Flood susceptibility above the tier limit (HAND)',
  [EXCLUSION.HAND_UNRESOLVED]: 'Flood susceptibility not resolved — withheld, not cleared',
};

/** OSM-derived land-use classes on the grid. */
export const LANDUSE = {
  UNMAPPED: 0,
  PADDY: 2,
  OPEN: 3,
  FOREST: 4,
  RESTRICTED: 5,
  BUILT_UP: 6,
} as const;

export interface Rules {
  radiusKm: number;
  /** Sphere puts camp gradient at 5-7%; ~4-5 deg. Adjustable because in steep
   *  terrain a hard 4 deg can leave almost nothing, and that is itself a
   *  finding worth seeing rather than hiding. */
  maxSlopeDeg: number;
  /** Minimum metres above the local drainage minimum.
   *
   *  DEFAULTS TO 0, i.e. off. The floodplain control is the published KSDMA
   *  flood landform layer, which is a real survey product. This local-relief
   *  proxy duplicates it badly: flat ground is by definition close to its own
   *  local minimum, so applying it as a hard rule alongside a gradient limit
   *  eliminates precisely the land that passes both. Left available as a
   *  tightening control, not used as a default constraint. */
  minDrainageMarginM: number;
  /** Landslide class at or above this is excluded (2 = Medium). */
  maxLandslideClass: number;
  /** Smallest cluster worth calling a zone, hectares. At a 100 m grid one
   *  cell is exactly 1 ha, so this is also the cell count. Sphere's 45 m2 per
   *  person makes ~8.5 ha the floor for a habitation of 1,880. */
  minZoneHa: number;
  /** Morphological opening passes on the eligible mask.
   *
   *  Slope at 100 m from a 30 m DEM is genuinely noisy in the Ghats, so the raw
   *  mask is speckle: isolated eligible cells ringed by steep ground. Those are
   *  real in the data and useless for siting -- you cannot pitch a camp on a
   *  pixel. Erode-then-dilate removes specks and filaments while leaving solid
   *  patches their original size. */
  openingPasses: number;
  /** Minimum spacing between shortlisted zones, km.
   *
   *  DEFAULTS TO 0. Merging replaces it: two clusters 900 m apart should be one
   *  area with combined capacity, not one discarding the other. Left as a
   *  control for forcing spread beyond the merge distance. */
  minSeparationKm: number;
  /** Exclude built-up land. You cannot pitch a camp on somebody's house, and
   *  without this a cluster spanning a town and open land beside it fits one
   *  ellipse over both -- putting the centroid on the houses. */
  excludeBuiltUp: boolean;
  /** Exclude paddy: flat, tempting, and seasonally waterlogged. */
  excludePaddy: boolean;
  /** Permanent tier only. Forest needs diversion under the Forest
   *  (Conservation) Act 1980, which is not obtainable on a resettlement
   *  timeline. Camps can sometimes use cleared forest fringe; townships cannot. */
  excludeForest: boolean;
  /** Wildlife Protection Act 1972 and notified eco-sensitive zones. */
  excludeProtected: boolean;
  /** Flood AOIs only. Exclude cells whose Aqueduct return-period class is at
   *  or above this. Classes are 3 (inundated at a return period of 10 years or
   *  less), 2 (11-100 years), 1 (101-1000), 0 (dry at every modelled return
   *  period). The 1-in-100 boundary is the standard design return period in
   *  Indian and international practice, so `2` means literally "outside the
   *  design flood".
   *
   *  This supersedes maxHandClass as the flood constraint: Aqueduct is a
   *  published, physically modelled product carrying nine return periods,
   *  where HAND was a local model calibrated to AUC 0.715 against three
   *  sampled years. HAND remains available as a finer-grained layer -- it is
   *  100 m against Aqueduct's ~900 m -- but no longer gates siting. */
  maxFloodRpClass?: number;
  /** Flood AOIs only. Exclude cells whose HAND susceptibility class is at or
   *  above this, on the same "at or above is excluded" convention as
   *  maxLandslideClass. Classes are 3 High, 2 Moderate, 1 Low, 0 Negligible,
   *  calibrated against observed flood extent -- see scripts/build-hand.py.
   *
   *  Undefined where no HAND layer exists, and the test then does not run.
   *  Cells the model could not resolve are excluded separately and labelled as
   *  withheld rather than cleared: on the Majuli grid those cells flood MORE
   *  often than resolved ones (0.376 against 0.308), so silence there is not
   *  evidence of safety. */
  maxHandClass?: number;
  /** Coastal AOIs only. Exclude land inside the shoreline position projected
   *  this many years forward at the locally measured retreat rate.
   *
   *  Optional and absent everywhere inland, where there is no shoreline to
   *  retreat and no distance raster to measure against. Undefined and 0 both
   *  mean the test does not run -- see COASTAL_RULES for why it exists. */
  retreatSetbackYears?: number;
}

export const DEFAULT_RULES: Rules = {
  radiusKm: 30,
  maxSlopeDeg: 5,
  minDrainageMarginM: 0,
  maxLandslideClass: 2,
  minZoneHa: 8,
  openingPasses: 1,
  minSeparationKm: 0,
  excludeBuiltUp: true,
  excludePaddy: true,
  excludeForest: false,
  excludeProtected: false,
  /* Camp tier: exclude ground that floods at least once a decade. A
   * transitional camp stands for one season and is sited under time pressure;
   * holding it to the 1-in-100 standard would remove 39% of the Majuli search
   * area and leave nowhere to put people this week. The tier that must not
   * compromise is the permanent one. */
  maxFloodRpClass: 3,
};

/* ==========================================================================
 * PERMANENT RESETTLEMENT RULES
 *
 * Looser on gradient, far stricter on everything else. A township can terrace
 * to 15 degrees where a camp cannot exceed Sphere's 5; but permanent
 * settlement must sit outside EVERY mapped hazard class, not merely the worst
 * two -- you do not put people back into Low Hazard Zone for fifty years --
 * and it must be land that can actually be acquired.
 * ==========================================================================*/
export const PERMANENT_RULES: Rules = {
  radiusKm: 30,
  maxSlopeDeg: 15,
  minDrainageMarginM: 0,
  maxLandslideClass: 1,
  minZoneHa: 12,
  openingPasses: 1,
  minSeparationKm: 0,
  excludeBuiltUp: true,
  excludePaddy: true,
  excludeForest: true,
  excludeProtected: true,
  /* Permanent tier: outside the design flood. A township built to a fifty-year
   * life must not sit inside the 1-in-100, which is the return period every
   * Indian planning standard is written against. */
  maxFloodRpClass: 2,
};

/* ==========================================================================
 * COASTAL RESETTLEMENT RULES
 *
 * A separate rule set because the Wayanad rules do not merely need retuning
 * on a delta -- their binding constraint stops existing. In the Ghats the
 * 5-degree gradient limit is what eliminates land. On the Kendrapara delta
 * almost nothing exceeds 5 degrees, so the same rule excludes nothing, and a
 * run would return a confident shortlist selected on essentially no criterion
 * at all. maxLandslideClass is likewise inert: there is no landslide raster
 * for a delta and nothing to exclude with it.
 *
 * What binds here instead is horizontal: distance from a shoreline that is
 * measurably moving inland, and elevation above the surge envelope. The first
 * of those is now a measurement rather than a judgement -- see
 * src/data/shoreline-kendrapara.ts.
 *
 * NOT YET RUNNABLE. Zone derivation reads a terrain stack, and none has been
 * built for this area of interest; `retreatSetbackYears` also needs a
 * shoreline distance raster that does not exist yet. The rules are defined
 * here so the constraint set is reviewable before the stack is built, not so
 * that something can be run against the wrong ground.
 * ==========================================================================*/
export const COASTAL_RULES: Rules = {
  radiusKm: 30,
  /* Not a real constraint on a delta. Left at the permanent-tier value so it
   * is never the reason a cell passes, and so nothing here reads as if a
   * gradient test were doing work it is not. */
  maxSlopeDeg: 15,
  minDrainageMarginM: 0,
  /* No landslide raster exists for this AOI. 1 rather than 0 so that if one is
   * ever supplied, the permanent-tier standard applies rather than a value
   * chosen to be inert. */
  maxLandslideClass: 1,
  minZoneHa: 12,
  openingPasses: 1,
  minSeparationKm: 0,
  excludeBuiltUp: true,
  /* Paddy is most of the cultivable delta. Excluding it here would be
   * excluding the district, so the exclusion moves to the land-tenure check
   * that a coastal candidate has to pass anyway. */
  excludePaddy: false,
  excludeForest: true,
  /* Bhitarkanika and its eco-sensitive zone. Non-negotiable on this coast:
   * Wildlife Protection Act 1972 with the ESZ notification bars residential
   * township use outright. */
  excludeProtected: true,

  /* Coastal-only. A site must sit outside the shoreline position projected
   * this many years forward at the local measured retreat rate.
   *
   * Fifty years is the design life a resettlement township is built to, and
   * siting inside the envelope means relocating the same people twice. At the
   * Kanhupur reach median of ~6.5 m/yr that is a setback of roughly 325 m;
   * at the fastest transect in the same reach, roughly 425 m. The rate is
   * per-transect, so the setback varies along the coast rather than being one
   * national number.
   *
   * Zero disables the test, which is the correct value for every inland AOI. */
  retreatSetbackYears: 50,
};

export interface Weights {
  /** Contiguous area relative to what this habitation needs. Ranking on the
   *  mean of per-cell factors alone is size-blind: a 9 ha patch and a 113 ha
   *  patch compete on average slope and distance, so small well-placed
   *  fragments outrank large ones. For a camp, size IS a criterion. */
  area: number;
  slope: number;
  distOrigin: number;
  distRoad: number;
  distTown: number;
  drainage: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  area: 0.25,
  slope: 0.15,
  distOrigin: 0.2,
  distRoad: 0.2,
  distTown: 0.15,
  drainage: 0.05,
};

/* ---------------------------------------------------------------- crop --- */

export interface Crop {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** lon/lat of the crop's outer edges, for georeferencing the raster. */
  bounds: [number, number, number, number];
  lonAt: (x: number) => number;
  latAt: (y: number) => number;
}

export function cropFor(m: TerrainManifest, origin: [number, number], radiusKm: number): Crop {
  const [w, s, e, n] = m.bounds;
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((origin[1] * Math.PI) / 180));
  const gx = (lon: number) => ((lon - w) / (e - w)) * (m.width - 1);
  const gy = (lat: number) => ((n - lat) / (n - s)) * (m.height - 1);

  const x0 = Math.max(0, Math.floor(gx(origin[0] - dLon)));
  const x1 = Math.min(m.width - 1, Math.ceil(gx(origin[0] + dLon)));
  const y0 = Math.max(0, Math.floor(gy(origin[1] + dLat)));
  const y1 = Math.min(m.height - 1, Math.ceil(gy(origin[1] - dLat)));

  const lonAt = (x: number) => w + ((x + x0) / (m.width - 1)) * (e - w);
  const latAt = (y: number) => n - ((y + y0) / (m.height - 1)) * (n - s);

  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const half = 0.5;
  return {
    x0,
    y0,
    w: cw,
    h: ch,
    bounds: [
      lonAt(-half),
      latAt(ch - 1 + half),
      lonAt(cw - 1 + half),
      latAt(-half),
    ],
    lonAt,
    latAt,
  };
}

/* ------------------------------------------------- drainage margin proxy --- */

/**
 * Metres above the lowest ground within `radius` cells. A separable min-filter,
 * which is a cheap stand-in for height-above-nearest-drainage: proper HAND
 * needs flow accumulation, and this catches the case that matters -- valley
 * floors that are flat because they flood.
 */
function drainageMargin(elev: Uint8Array, w: number, h: number, radius: number, scale: number) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mn = Infinity;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        const v = elev[y * w + xx];
        if (v < mn) mn = v;
      }
      tmp[y * w + x] = mn;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mn = Infinity;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        const v = tmp[yy * w + x];
        if (v < mn) mn = v;
      }
      out[y * w + x] = (elev[y * w + x] - mn) * scale;
    }
  }
  return out;
}

/* --------------------------------------------------- morphological open --- */

/** Erode then dilate, `passes` times. Operates on an eligible/not bitmap. */
function open(mask: Uint8Array, w: number, h: number, passes: number): Uint8Array {
  let cur = mask;
  for (let p = 0; p < passes; p++) {
    const eroded = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cur[i]) continue;
        let all = 1;
        for (let dy = -1; dy <= 1 && all; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !cur[ny * w + nx]) {
              all = 0;
              break;
            }
          }
        }
        eroded[i] = all;
      }
    }
    const dilated = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!eroded[i]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) dilated[ny * w + nx] = 1;
          }
        }
      }
    }
    /* dilation must not resurrect cells the hard rules excluded */
    for (let i = 0; i < w * h; i++) dilated[i] = dilated[i] && mask[i] ? 1 : 0;
    cur = dilated;
  }
  return cur;
}

/* ------------------------------------------------------------ analysis --- */

export interface CellFactors {
  landuse: number;
  slope: number;
  distOriginKm: number;
  distRoadM: number;
  distTownM: number;
  drainageM: number;
}

export interface Zone {
  id: number;
  rank: number;
  cells: number;
  areaHa: number;
  centroid: [number, number];
  /** Ellipse: semi-axes in metres and rotation, from the cell covariance. */
  semiMajorM: number;
  semiMinorM: number;
  angleDeg: number;
  score: number;
  factors: CellFactors;
  /** Contribution of each weighted factor to `score`. */
  contributions: Record<keyof Weights, number>;
  distOriginKm: number;
  capacityPersons: number;
  nearestTown: { name: string; km: number } | null;
  /** Second moments in metres about the centroid, and the raw factor sums.
   *  Kept so nearby clusters can be merged EXACTLY (parallel-axis theorem)
   *  rather than by approximating one ellipse from several. */
  moments: { cxx: number; cyy: number; cxy: number };
  sums: number[];
  /** Ids of the clusters folded into this one. Length 1 when unmerged. */
  memberIds: number[];
}

export interface ZoneResult {
  crop: Crop;
  /** Per-cell exclusion code, crop-local. */
  reason: Uint8Array;
  /** 0-100 suitability, crop-local; 0 where excluded. */
  score: Uint8Array;
  zones: Zone[];
  stats: {
    cellsInRadius: number;
    eligibleCells: number;
    eligibleHa: number;
    eligiblePct: number;
    byReason: Record<number, number>;
    clustersFound: number;
    clustersBelowFloor: number;
    removedByOpening: number;
  };
}

const SPHERE_M2_PER_PERSON = 45;

export function analyse(
  stack: TerrainStack,
  origin: [number, number],
  rules: Rules,
  weights: Weights,
  requiredPersons: number,
): ZoneResult {
  const { manifest, grids } = stack;
  const crop = cropFor(manifest, origin, rules.radiusKm);
  const { w, h } = crop;
  const n = w * h;
  const cellM = manifest.cellMetres;
  const cellHa = (cellM * cellM) / 10000;

  const g = (key: string, x: number, y: number) =>
    grids[key][(y + crop.y0) * manifest.width + (x + crop.x0)];

  /* elevation is stored /10; drainage margin wants metres */
  const elevRaw = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      elevRaw[y * w + x] = grids['elevation']
        ? grids['elevation'][(y + crop.y0) * manifest.width + (x + crop.x0)]
        : 0;
  const margin = drainageMargin(elevRaw, w, h, 5, 10);

  const reason = new Uint8Array(n);
  const score = new Uint8Array(n);
  const byReason: Record<number, number> = {};
  let cellsInRadius = 0;
  let eligibleCells = 0;

  /* normalisers */
  const maxRoadM = 3000;
  const maxTownM = 15000;
  const maxOriginKm = rules.radiusKm;

  const factorsAt = new Float32Array(n * 6);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lon = crop.lonAt(x);
      const lat = crop.latAt(y);
      const dOrigin = haversineKm([lon, lat], origin);

      if (dOrigin > rules.radiusKm) {
        reason[i] = EXCLUSION.OUTSIDE_RADIUS;
        continue;
      }
      cellsInRadius++;

      const slope = g('slope', x, y);
      const ls = Math.round(g('landslide', x, y) / 80);
      const fl = Math.round(g('flood', x, y) / 80);
      const lu = grids['landuse'] ? Math.round(g('landuse', x, y) / 40) : 0;
      const roadM = g('distroad', x, y) * 50;
      const townM = g('disttown', x, y) * 200;
      const drain = margin[i];

      const prot = grids['protected'] ? g('protected', x, y) : 0;
      /* Raw, not divided: 255 is the "not resolved" sentinel and must not be
       * rounded into a class. See scripts/build-hand.py. */
      const handRaw = grids['hand'] ? g('hand', x, y) : -1;
      const frp = grids['floodrp'] ? Math.round(g('floodrp', x, y) / 80) : -1;

      let code: number = EXCLUSION.NONE;
      if (rules.excludeProtected && prot > 127) code = EXCLUSION.PROTECTED;
      else if (rules.excludeBuiltUp && lu === LANDUSE.BUILT_UP) code = EXCLUSION.BUILT_UP;
      else if (rules.excludeForest && lu === LANDUSE.FOREST) code = EXCLUSION.FOREST;
      else if (lu === LANDUSE.RESTRICTED) code = EXCLUSION.RESTRICTED;
      else if (rules.excludePaddy && lu === LANDUSE.PADDY) code = EXCLUSION.PADDY;
      else if (ls >= rules.maxLandslideClass) code = EXCLUSION.LANDSLIDE;
      else if (
        rules.maxFloodRpClass !== undefined &&
        frp >= 0 &&
        frp >= rules.maxFloodRpClass
      )
        code = EXCLUSION.FLOOD_RP;
      else if (handRaw === 255) code = EXCLUSION.HAND_UNRESOLVED;
      else if (
        rules.maxHandClass !== undefined &&
        handRaw >= 0 &&
        Math.round(handRaw / 80) >= rules.maxHandClass
      )
        code = EXCLUSION.HAND;
      /* Kept alongside HAND rather than replaced by it. The flood sheet is the
       * OBSERVED record and HAND is a model calibrated against it; where the
       * two disagree, observed extent wins. */
      else if (fl >= 1) code = EXCLUSION.FLOOD;
      else if (slope > rules.maxSlopeDeg) code = EXCLUSION.SLOPE;
      else if (rules.minDrainageMarginM > 0 && drain < rules.minDrainageMarginM)
        code = EXCLUSION.DRAINAGE;

      reason[i] = code;
      byReason[code] = (byReason[code] ?? 0) + 1;
      if (code !== EXCLUSION.NONE) continue;

      eligibleCells++;
      const fSlope = 1 - Math.min(1, slope / rules.maxSlopeDeg);
      const fOrigin = 1 - Math.min(1, dOrigin / maxOriginKm);
      const fRoad = 1 - Math.min(1, roadM / maxRoadM);
      const fTown = 1 - Math.min(1, townM / maxTownM);
      const fDrain = Math.min(1, drain / 20);

      /* The per-cell score omits area, which is a property of the cluster, not
       * the cell. Cell scores colour the surface; cluster scores do the ranking.
       * Rescaled by 1/(1-area weight) so the surface still spans 0-100. */
      const s =
        fSlope * weights.slope +
        fOrigin * weights.distOrigin +
        fRoad * weights.distRoad +
        fTown * weights.distTown +
        fDrain * weights.drainage;
      score[i] = Math.max(1, Math.round((s / Math.max(0.01, 1 - weights.area)) * 100));

      factorsAt[i * 6] = slope;
      factorsAt[i * 6 + 1] = dOrigin;
      factorsAt[i * 6 + 2] = roadM;
      factorsAt[i * 6 + 3] = townM;
      factorsAt[i * 6 + 4] = drain;
      factorsAt[i * 6 + 5] = lu;
    }
  }

  /* --------------------------------------------------------- despeckle */
  let removedByOpening = 0;
  if (rules.openingPasses > 0) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = reason[i] === EXCLUSION.NONE ? 1 : 0;
    const opened = open(mask, w, h, rules.openingPasses);
    for (let i = 0; i < n; i++) {
      if (mask[i] && !opened[i]) {
        reason[i] = EXCLUSION.SPECKLE;
        score[i] = 0;
        eligibleCells--;
        removedByOpening++;
        byReason[EXCLUSION.NONE]--;
        byReason[EXCLUSION.SPECKLE] = (byReason[EXCLUSION.SPECKLE] ?? 0) + 1;
      }
    }
  }

  /* ------------------------------------------------- connected components */
  const label = new Int32Array(n).fill(-1);
  const clusters: number[][] = [];
  const stack2: number[] = [];
  for (let i = 0; i < n; i++) {
    if (reason[i] !== EXCLUSION.NONE || label[i] !== -1) continue;
    const id = clusters.length;
    const members: number[] = [];
    stack2.push(i);
    label[i] = id;
    while (stack2.length) {
      const c = stack2.pop()!;
      members.push(c);
      const cx = c % w;
      const cy = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (reason[j] !== EXCLUSION.NONE || label[j] !== -1) continue;
          label[j] = id;
          stack2.push(j);
        }
      }
    }
    clusters.push(members);
  }

  const minCells = Math.max(1, Math.round(rules.minZoneHa / cellHa));
  const kept = clusters.filter((c) => c.length >= minCells);

  /* ------------------------------------------------------------ fit + rank */
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((origin[1] * Math.PI) / 180);

  const zones: Zone[] = kept.map((members, idx) => {
    let sx = 0;
    let sy = 0;
    const acc = [0, 0, 0, 0, 0, 0];
    const luCount = new Map<number, number>();
    let sScore = 0;
    for (const i of members) {
      sx += crop.lonAt(i % w);
      sy += crop.latAt((i / w) | 0);
      for (let k = 0; k < 6; k++) acc[k] += factorsAt[i * 6 + k];
      const luv = factorsAt[i * 6 + 5];
      luCount.set(luv, (luCount.get(luv) ?? 0) + 1);
      sScore += score[i];
    }
    const cLon = sx / members.length;
    const cLat = sy / members.length;

    /* covariance in metres -> principal axes */
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (const i of members) {
      const dx = (crop.lonAt(i % w) - cLon) * mPerDegLon;
      const dy = (crop.latAt((i / w) | 0) - cLat) * mPerDegLat;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    }
    cxx /= members.length;
    cyy /= members.length;
    cxy /= members.length;
    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.max(0, (tr * tr) / 4 - det);
    const l1 = tr / 2 + Math.sqrt(disc);
    const l2 = Math.max(0, tr / 2 - Math.sqrt(disc));
    /* 2 sigma covers the bulk of the cluster without implying a boundary */
    const semiMajorM = Math.max(cellM, 2 * Math.sqrt(l1));
    const semiMinorM = Math.max(cellM * 0.6, 2 * Math.sqrt(l2));
    const angleDeg = (Math.atan2(2 * cxy, cxx - cyy) / 2) * (180 / Math.PI);

    const areaHa = members.length * cellHa;
    let domLu = 0;
    let domN = -1;
    for (const [k, v] of luCount) if (v > domN) { domN = v; domLu = k; }
    const f: CellFactors = {
      landuse: domLu,
      slope: acc[0] / members.length,
      distOriginKm: acc[1] / members.length,
      distRoadM: acc[2] / members.length,
      distTownM: acc[3] / members.length,
      drainageM: acc[4] / members.length,
    };

    const capacityPersons = Math.floor((areaHa * 10000) / SPHERE_M2_PER_PERSON);
    /* Saturates at three times the requirement -- enough headroom to matter,
     * bounded so a vast remote patch cannot buy its way to the top. */
    const fArea = Math.min(1, capacityPersons / Math.max(1, requiredPersons * 3));
    const fSlope = 1 - Math.min(1, f.slope / rules.maxSlopeDeg);
    const fOrigin = 1 - Math.min(1, f.distOriginKm / maxOriginKm);
    const fRoad = 1 - Math.min(1, f.distRoadM / maxRoadM);
    const fTown = 1 - Math.min(1, f.distTownM / maxTownM);
    const fDrain = Math.min(1, f.drainageM / 20);
    const contributions = {
      area: fArea * weights.area * 100,
      slope: fSlope * weights.slope * 100,
      distOrigin: fOrigin * weights.distOrigin * 100,
      distRoad: fRoad * weights.distRoad * 100,
      distTown: fTown * weights.distTown * 100,
      drainage: fDrain * weights.drainage * 100,
    };

    let nearestTown: Zone['nearestTown'] = null;
    for (const t of manifest.towns) {
      if (t.place !== 'town' && t.place !== 'city') continue;
      if (!t.name) continue;
      const km = haversineKm([t.lon, t.lat], [cLon, cLat]);
      if (!nearestTown || km < nearestTown.km) nearestTown = { name: t.name, km };
    }

    return {
      id: idx,
      rank: 0,
      cells: members.length,
      areaHa,
      centroid: [cLon, cLat] as [number, number],
      semiMajorM,
      semiMinorM,
      angleDeg,
      score:
        fArea * weights.area * 100 +
        fSlope * weights.slope * 100 +
        fOrigin * weights.distOrigin * 100 +
        fRoad * weights.distRoad * 100 +
        fTown * weights.distTown * 100 +
        fDrain * weights.drainage * 100,
      factors: f,
      contributions,
      distOriginKm: haversineKm([cLon, cLat], origin),
      capacityPersons,
      nearestTown,
      moments: { cxx, cyy, cxy },
      sums: acc.slice(),
      memberIds: [idx],
    };
  });

  zones.sort((a, b) => b.score - a.score);
  zones.forEach((z, i) => (z.rank = i + 1));

  return {
    crop,
    reason,
    score,
    zones,
    stats: {
      cellsInRadius,
      eligibleCells,
      eligibleHa: eligibleCells * cellHa,
      eligiblePct: cellsInRadius ? (eligibleCells / cellsInRadius) * 100 : 0,
      byReason,
      clustersFound: clusters.length,
      clustersBelowFloor: clusters.length - kept.length,
      removedByOpening,
    },
  };
}

/* =============================================================================
 * ZOOM-DEPENDENT MERGING
 *
 * Two clusters 900 m apart are not competing recommendations; they are one
 * area. Merging says so, and it subsumes the separation rule -- rather than
 * discarding the lower-ranked neighbour, their capacities combine.
 *
 * Zoomed out an officer wants "candidate ground is over here, roughly"; zoomed
 * in they want the individual patches to judge. Same level-of-detail argument
 * as point density on the national map.
 *
 * Moments combine exactly via the parallel-axis theorem, so a merged ellipse
 * is a true second-moment fit over the union of cells, not an average of
 * ellipses.
 * ========================================================================== */

/** Merge distance for a map zoom. 0 means show every cluster separately. */
export function mergeKmForZoom(zoom: number): number {
  if (zoom >= 13.5) return 0;
  if (zoom >= 12.5) return 0.8;
  if (zoom >= 11.5) return 1.6;
  if (zoom >= 10.5) return 3.2;
  if (zoom >= 9.5) return 6;
  return 10;
}

export function mergeZones(
  zones: Zone[],
  km: number,
  rules: Rules,
  weights: Weights,
  requiredPersons: number,
  cellHa: number,
): Zone[] {
  if (km <= 0 || zones.length < 2) return zones.map((z) => ({ ...z }));

  /* Leader clustering, seeded by rank.
   *
   * NOT single-linkage: that chains. With 544 clusters spread over a 30 km
   * radius, "A near B, B near C" links the entire search area into one blob at
   * any useful merge distance. Leader clustering takes the best unassigned
   * cluster as a seed and absorbs only what is within `km` OF THE SEED, so a
   * merged area's diameter is bounded at 2 km and cannot grow by chaining. */
  const byRank = [...zones].sort((a, b) => b.score - a.score);
  const taken = new Set<number>();
  const groups: Zone[][] = [];
  for (const seed of byRank) {
    if (taken.has(seed.id)) continue;
    taken.add(seed.id);
    const members = [seed];
    for (const other of byRank) {
      if (taken.has(other.id)) continue;
      if (haversineKm(seed.centroid, other.centroid) <= km) {
        taken.add(other.id);
        members.push(other);
      }
    }
    groups.push(members);
  }

  const mPerDegLat = 111320;
  const out: Zone[] = [];
  for (const members of groups) {
    if (members.length === 1) {
      /* Clone. Ranks are reassigned below, and pushing the original reference
       * would mutate the caller's zone list -- corrupting ranks for every
       * other zoom level that reads it. */
      out.push({ ...members[0] });
      continue;
    }
    const nTotal = members.reduce((a, z) => a + z.cells, 0);
    const cLon = members.reduce((a, z) => a + z.centroid[0] * z.cells, 0) / nTotal;
    const cLat = members.reduce((a, z) => a + z.centroid[1] * z.cells, 0) / nTotal;
    const mPerDegLon = 111320 * Math.cos((cLat * Math.PI) / 180);

    /* parallel-axis: C = sum n_i (C_i + d_i d_i^T) / n */
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (const z of members) {
      const dx = (z.centroid[0] - cLon) * mPerDegLon;
      const dy = (z.centroid[1] - cLat) * mPerDegLat;
      cxx += z.cells * (z.moments.cxx + dx * dx);
      cyy += z.cells * (z.moments.cyy + dy * dy);
      cxy += z.cells * (z.moments.cxy + dx * dy);
    }
    cxx /= nTotal;
    cyy /= nTotal;
    cxy /= nTotal;

    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.max(0, (tr * tr) / 4 - det);
    const l1 = tr / 2 + Math.sqrt(disc);
    const l2 = Math.max(0, tr / 2 - Math.sqrt(disc));

    const sums = members[0].sums.map((_, k) =>
      members.reduce((a, z) => a + z.sums[k], 0),
    );
    const f: CellFactors = {
      landuse: members[0].factors.landuse,
      slope: sums[0] / nTotal,
      distOriginKm: sums[1] / nTotal,
      distRoadM: sums[2] / nTotal,
      distTownM: sums[3] / nTotal,
      drainageM: sums[4] / nTotal,
    };
    const areaHa = nTotal * cellHa;
    const capacityPersons = Math.floor((areaHa * 10000) / SPHERE_M2_PER_PERSON);

    const fArea = Math.min(1, capacityPersons / Math.max(1, requiredPersons * 3));
    const fSlope = 1 - Math.min(1, f.slope / rules.maxSlopeDeg);
    const fOrigin = 1 - Math.min(1, f.distOriginKm / rules.radiusKm);
    const fRoad = 1 - Math.min(1, f.distRoadM / 3000);
    const fTown = 1 - Math.min(1, f.distTownM / 15000);
    const fDrain = Math.min(1, f.drainageM / 20);

    const best = members.reduce((a, z) => (z.score > a.score ? z : a));
    out.push({
      ...best,
      id: Math.min(...members.map((z) => z.id)),
      cells: nTotal,
      areaHa,
      centroid: [cLon, cLat],
      semiMajorM: Math.max(100, 2 * Math.sqrt(l1)),
      semiMinorM: Math.max(60, 2 * Math.sqrt(l2)),
      angleDeg: (Math.atan2(2 * cxy, cxx - cyy) / 2) * (180 / Math.PI),
      factors: f,
      contributions: {
        area: fArea * weights.area * 100,
        slope: fSlope * weights.slope * 100,
        distOrigin: fOrigin * weights.distOrigin * 100,
        distRoad: fRoad * weights.distRoad * 100,
        distTown: fTown * weights.distTown * 100,
        drainage: fDrain * weights.drainage * 100,
      },
      score:
        fArea * weights.area * 100 +
        fSlope * weights.slope * 100 +
        fOrigin * weights.distOrigin * 100 +
        fRoad * weights.distRoad * 100 +
        fTown * weights.distTown * 100 +
        fDrain * weights.drainage * 100,
      capacityPersons,
      moments: { cxx, cyy, cxy },
      sums,
      memberIds: members.flatMap((z) => z.memberIds),
    });
  }

  out.sort((a, b) => b.score - a.score);
  out.forEach((z, i) => (z.rank = i + 1));
  return out;
}

/**
 * Shortlist with geographic separation.
 *
 * Ranking alone will happily return five zones on the same hillside, and one
 * failure then takes the whole shortlist. Same reasoning as not offering three
 * routes that all cross the same bridge. This walks the ranking and skips any
 * zone within `minSeparationKm` of one already chosen, recording what it
 * dropped and for whom -- trading a point of suitability for independence is a
 * decision the officer should see, not one made silently.
 */
export interface Shortlisted {
  zone: Zone;
  displaced: Array<{ rank: number; km: number; score: number }>;
}

export function shortlist(
  zones: Zone[],
  count: number,
  minSeparationKm: number,
): Shortlisted[] {
  const out: Shortlisted[] = [];
  for (const z of zones) {
    if (out.length >= count) break;
    const clash = out.find(
      (o) => haversineKm(o.zone.centroid, z.centroid) < minSeparationKm,
    );
    if (clash) {
      clash.displaced.push({
        rank: z.rank,
        km: haversineKm(clash.zone.centroid, z.centroid),
        score: z.score,
      });
      continue;
    }
    out.push({ zone: z, displaced: [] });
  }
  return out;
}

/** Ellipse as a GeoJSON polygon, for drawing. Rough by design. */
/** Hard ceiling on how much ground a drawn ellipse may cover, as a multiple
 *  of the eligible area it summarises.
 *
 *  The 2-sigma ellipse of a sprawling merged cluster is enormous -- a group of
 *  37 sub-clusters strung along 15 km of valley fits an ellipse covering the
 *  better part of the search radius, nearly all of which failed the filter.
 *  At that size the ellipse stops meaning "eligible ground clusters here" and
 *  starts meaning nothing at all. Capping its AREA against the cluster's own
 *  eligible hectares keeps the shape and bearing while bounding the claim: the
 *  drawn ellipse never depicts more than this multiple of ground that actually
 *  passed. Rendering only -- the stored second moment, area, capacity and rank
 *  are untouched. */
const MAX_ELLIPSE_AREA_RATIO = 1.6;

/** Hard ceiling on the drawn semi-major axis, metres.
 *
 *  The area ratio alone does not bound absolute size: a cluster with enough
 *  eligible ground still earns an ellipse spanning most of a 30 km operation
 *  radius, which tells an officer to go and look at the whole district. Past
 *  roughly 6 km across, an ellipse has stopped pointing anywhere. */
const MAX_SEMI_MAJOR_M = 3000;

export function ellipseFeature(z: Zone, selected: boolean): GeoJSON.Feature {
  const [lon, lat] = z.centroid;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const th = (z.angleDeg * Math.PI) / 180;

  let a = z.semiMajorM;
  let b = z.semiMinorM;
  const drawnM2 = Math.PI * a * b;
  const capM2 = MAX_ELLIPSE_AREA_RATIO * z.areaHa * 10_000;
  if (capM2 > 0 && drawnM2 > capM2) {
    /* Scale both axes by the same factor: bearing and aspect are real
     * properties of the cluster and must survive the clamp. */
    const k = Math.sqrt(capM2 / drawnM2);
    a *= k;
    b *= k;
  }
  if (a > MAX_SEMI_MAJOR_M) {
    const k = MAX_SEMI_MAJOR_M / a;
    a *= k;
    b *= k;
  }

  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    const rx = x * Math.cos(th) - y * Math.sin(th);
    const ry = x * Math.sin(th) + y * Math.cos(th);
    pts.push([lon + rx / mPerDegLon, lat + ry / mPerDegLat]);
  }
  return {
    type: 'Feature',
    properties: {
      id: z.id,
      rank: z.rank,
      score: Math.round(z.score),
      selected,
      /** True when the drawn ellipse was clamped, i.e. the cluster is more
       *  scattered than the outline suggests. */
      clamped:
        z.semiMajorM > MAX_SEMI_MAJOR_M ||
        Math.PI * z.semiMajorM * z.semiMinorM > MAX_ELLIPSE_AREA_RATIO * z.areaHa * 10_000,
    },
    geometry: { type: 'Polygon', coordinates: [pts] },
  };
}
