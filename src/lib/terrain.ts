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

export type StageState = 'pending' | 'active' | 'done' | 'failed';

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
  { key: 'landslide', label: 'Landslide hazard', detail: 'KSDMA zonation, rasterised' },
  { key: 'flood', label: 'Flood landform', detail: 'KSDMA landform, rasterised' },
  { key: 'distroad', label: 'Road access', detail: 'Distance surface to tertiary+ roads' },
  { key: 'disttown', label: 'Settlement access', detail: 'Distance surface to towns' },
  { key: 'landuse', label: 'Land use', detail: 'OSM land use — built-up, cultivated, forest' },
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

const RASTER_KEYS = ['slope', 'landslide', 'flood', 'distroad', 'disttown', 'landuse', 'protected'] as const;

export async function loadTerrain(
  onStage: (key: string, state: StageState, note?: string) => void,
): Promise<TerrainStack> {
  onStage('manifest', 'active');
  const manifest: TerrainManifest = await fetch('/terrain/manifest.json').then((r) => {
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
      onStage(key, 'failed', 'layer absent from manifest');
      continue;
    }
    onStage(key, 'active');
    try {
      grids[key] = await decodePng(layer.file, manifest.width, manifest.height);
      onStage(key, 'done', `${(layer.bytes / 1024).toFixed(0)} KB decoded`);
    } catch (err) {
      onStage(key, 'failed', String(err));
    }
  }

  onStage('roads', 'active');
  const roads: GeoJSON.FeatureCollection = await fetch('/terrain/roads.geojson').then((r) => {
    if (!r.ok) throw new Error(`roads ${r.status}`);
    return r.json();
  });
  const vertices = roads.features.reduce(
    (n, f) => n + ((f.geometry as GeoJSON.LineString).coordinates?.length ?? 0),
    0,
  );
  onStage('roads', 'done', `${roads.features.length.toLocaleString()} ways · ${vertices.toLocaleString()} vertices`);

  onStage('graph', 'active');
  const graph: RoadGraphData = await fetch('/terrain/road-graph.json').then((r) => {
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
   * than blocking short-term. */
  const [taluks, hosts, amenities] = await Promise.all([
    fetch('/terrain/taluks.geojson').then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined),
    fetch('/terrain/host-population.json').then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined),
    fetch('/terrain/amenities.json').then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined),
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
