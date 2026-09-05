/* ============================================================================
 * TERRAIN STACK LOADER
 *
 * The Module 2 analysis surfaces are shipped as co-registered grayscale PNGs
 * and decoded here into typed arrays via a canvas. That keeps the factor
 * surfaces precomputed while leaving the weighted combination to run live in
 * the browser -- which is what lets an officer move weights and watch zones
 * recompute without a backend.
 *
 * Loading is staged and reports progress, because it is genuinely several
 * megabytes of raster and vector data and the operator should see what is
 * being pulled rather than watch a spinner.
 * ==========================================================================*/

export interface TerrainLayerMeta {
  file: string;
  unit?: string;
  scale?: number;
  classes?: Record<string, number>;
  bytes: number;
}

export interface TerrainTown {
  name: string | null;
  lat: number;
  lon: number;
  place?: string;
  population?: number | null;
}

export interface TerrainFacility {
  name: string | null;
  lat: number;
  lon: number;
  amenity?: string;
}

export interface TerrainManifest {
  bounds: [number, number, number, number];
  width: number;
  height: number;
  cellMetres: number;
  layers: Record<string, TerrainLayerMeta>;
  towns: TerrainTown[];
  facilities: TerrainFacility[];
}

export interface RoadGraphData {
  nodes: Array<[number, number]>;
  edges: Array<{
    a: number;
    b: number;
    hw: string;
    name: string | null;
    m: number;
    g: Array<[number, number]>;
  }>;
}

export interface HostBody {
  qid: string;
  name: string;
  type: string;
  population: number;
  lon: number;
  lat: number;
}

export interface Amenities {
  worship: Array<{ name: string | null; lat: number; lon: number }>;
  burial: Array<{ name: string | null; lat: number; lon: number }>;
  common: Array<{ name: string | null; lat: number; lon: number }>;
}

export interface TerrainStack {
  manifest: TerrainManifest;
  /** Raw 8-bit values, row-major, row 0 = north. Multiply by layer.scale. */
  grids: Record<string, Uint8Array>;
  roads: GeoJSON.FeatureCollection;
  graph: RoadGraphData;
  /** Long-term tier only; absent until that tab is opened. */
  taluks?: GeoJSON.FeatureCollection;
  hosts?: HostBody[];
  amenities?: Amenities;
}

/** `skipped` is not `failed`. A layer that was never built for this area of
 *  interest has not gone wrong, and marking it with a cross on the load screen
 *  reports a fault that did not happen. Only a layer that was present and
 *  could not be read is a failure. */
export type StageState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface Stage {
  key: string;
  label: string;
  detail: string;
  state: StageState;
  note?: string;
}

export const STAGES: Array<{ key: string; label: string; detail: string }> = [
  { key: 'manifest', label: 'Analysis grid', detail: 'Grid definition, settlements, facilities' },
  { key: 'slope', label: 'Terrain', detail: 'Copernicus GLO-30 derived slope, 100 m' },
  { key: 'land', label: 'Land and border', detail: 'Indian territory mask, district boundaries' },
  { key: 'landslide', label: 'Landslide hazard', detail: 'hazard zonation, rasterised' },
  { key: 'flood', label: 'Flood layer', detail: 'flood sheet, rasterised' },
  {
    key: 'floodrp',
    label: 'Flood return period',
    detail: 'WRI Aqueduct, smallest return period that inundates',
  },
  {
    key: 'hand',
    label: 'Height above drainage',
    detail: 'HAND, calibrated against observed extent',
  },
  { key: 'distroad', label: 'Road access', detail: 'Distance surface to tertiary+ roads' },
  { key: 'disttown', label: 'Settlement access', detail: 'Distance surface to towns' },
  { key: 'landuse', label: 'Land use', detail: 'OSM land use — built-up, cultivated, forest' },
  {
    key: 'buildings',
    label: 'Structure density',
    detail: 'Google Open Buildings — share of each cell under roof',
  },
  { key: 'protected', label: 'Protected areas', detail: 'Sanctuaries and eco-sensitive zones' },
  { key: 'roads', label: 'Road network', detail: 'OpenStreetMap linework' },
  { key: 'graph', label: 'Routing graph', detail: 'Ways split at junctions, real topology' },
  { key: 'crop', label: 'Search area', detail: 'Clipping the stack to the operation radius' },
];

/** Decode a grayscale PNG into a Uint8Array of its red channel. */
async function decodePng(url: string, width: number, height: number): Promise<Uint8Array> {
  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.blob();
  });
  const bmp = await createImageBitmap(blob);
  if (bmp.width !== width || bmp.height !== height) {
    throw new Error(`${url}: expected ${width}x${height}, got ${bmp.width}x${bmp.height}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = rgba[p];
  bmp.close();
  return out;
}

/* `hand` is present only for AOIs where it has been computed; a layer absent
 * from the manifest is reported as such rather than treated as zeros. */
const RASTER_KEYS = ['slope', 'land', 'landslide', 'flood', 'floodrp', 'distroad', 'disttown', 'landuse', 'protected', 'hand', 'buildings'] as const;

/**
 * @param base Directory the stack was built into, from the active case's
 *   `stack.base`. NOT optional in practice: hardcoding '/terrain' here meant
 *   selecting a different case loaded Kerala's rasters and then cropped them
 *   around a point 1,800 km away, which fails as an array allocation rather
 *   than as anything that names the real problem.
 */
export async function loadTerrain(
  onStage: (key: string, state: StageState, note?: string) => void,
  base = '/terrain',
): Promise<TerrainStack> {
  onStage('manifest', 'active');
  const manifest: TerrainManifest = await fetch(`${base}/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return r.json();
  });
  onStage(
    'manifest',
    'done',
    `${manifest.width}x${manifest.height} at ${manifest.cellMetres} m · ${manifest.towns.length} settlements · ${manifest.facilities.length} facilities`,
  );

  const grids: Record<string, Uint8Array> = {};
  for (const key of RASTER_KEYS) {
    const layer = manifest.layers[key];
    if (!layer) {
      onStage(key, 'skipped', 'not built for this area of interest');
      continue;
    }
    onStage(key, 'active');
    try {
      /* Resolved against `base` rather than taken verbatim. A manifest that
       * names another stack's files is not a hypothetical -- it shipped once,
       * and the symptom was an allocation failure rather than anything that
       * said "wrong AOI". */
      const file = `${base}/${layer.file.split('/').pop()}`;
      grids[key] = await decodePng(file, manifest.width, manifest.height);
      onStage(key, 'done', `${(layer.bytes / 1024).toFixed(0)} KB decoded`);
    } catch (err) {
      onStage(key, 'failed', String(err));
    }
  }

  onStage('roads', 'active');
  const roads: GeoJSON.FeatureCollection = await fetch(`${base}/roads.geojson`).then((r) => {
    if (!r.ok) throw new Error(`roads ${r.status}`);
    return r.json();
  });
  const vertices = roads.features.reduce(
    (n, f) => n + ((f.geometry as GeoJSON.LineString).coordinates?.length ?? 0),
    0,
  );
  onStage('roads', 'done', `${roads.features.length.toLocaleString()} ways · ${vertices.toLocaleString()} vertices`);

  onStage('graph', 'active');
  const graph: RoadGraphData = await fetch(`${base}/road-graph.json`).then((r) => {
    if (!r.ok) throw new Error(`graph ${r.status}`);
    return r.json();
  });
  onStage(
    'graph',
    'done',
    `${graph.edges.length.toLocaleString()} edges · ${graph.nodes.length.toLocaleString()} junctions`,
  );

  /* Long-term layers. Fetched with the rest because the stack is loaded once
   * and both tiers share it; a failure here degrades the long-term tab rather
   * than blocking short-term.
   *
   * These are OPTIONAL and not every stack ships them -- Kendrapara has no
   * taluks.geojson -- so a 404 here is the expected way absence is discovered,
   * not a fault. It is the one console 404 that survives on a healthy load;
   * anything else appearing beside it is worth chasing. */
  const [taluks, hosts, amenities] = await Promise.all([
    fetch(`${base}/taluks.geojson`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined),
    fetch(`${base}/host-population.json`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined),
    fetch(`${base}/amenities.json`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined),
  ]);

  return { manifest, grids, roads, graph, taluks, hosts, amenities };
}

/* ------------------------------------------------------------ geometry --- */

export interface Aoi {
  west: number;
  south: number;
  east: number;
  north: number;
  radiusKm: number;
}

export function aoiAround(lngLat: [number, number], radiusKm: number): Aoi {
  const [lon, lat] = lngLat;
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lon - dLon,
    south: lat - dLat,
    east: lon + dLon,
    north: lat + dLat,
    radiusKm,
  };
}

/** Grid indices for a lon/lat, or null if outside the analysis grid. */
export function cellAt(m: TerrainManifest, lon: number, lat: number): number | null {
  const [w, s, e, n] = m.bounds;
  if (lon < w || lon > e || lat < s || lat > n) return null;
  const x = Math.min(m.width - 1, Math.max(0, Math.round(((lon - w) / (e - w)) * (m.width - 1))));
  const y = Math.min(m.height - 1, Math.max(0, Math.round(((n - lat) / (n - s)) * (m.height - 1))));
  return y * m.width + x;
}

/** Great-circle distance in km. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
