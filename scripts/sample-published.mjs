/**
 * Sample every habitation against the published KSDMA hazard sheets and emit
 * src/data/published.ts.
 *
 * This is what turns the supplied KMZ files from a picture into evidence: each
 * habitation gains the class the PUBLISHER assigns to the ground it stands on,
 * carried with LIVE provenance, shown next to the placeholder factor model
 * rather than silently replacing it. Where the two disagree, the officer sees
 * the disagreement -- which is the whole point of showing both.
 *
 * Run: node scripts/sample-published.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const SHEETS = [
  {
    key: 'landslide',
    file: 'public/layers/wayanad-landslide.geojson',
    label: 'Landslide hazard zone',
    source: 'KSDMA landslide hazard zonation, Wayanad (WAYD_LS.kmz)',
    assessedOn: '2020-08-10T00:00:00+05:30',
  },
  {
    key: 'flood',
    file: 'public/layers/wayanad-flood.geojson',
    label: 'Flood landform',
    source: 'KSDMA flood landform mapping, Wayanad (Wayanad.kmz)',
    assessedOn: '2018-09-26T00:00:00+05:30',
  },
];

/* ---- geometry ---------------------------------------------------------- */

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outer ring contains the point and no hole excludes it. */
function inPolygon(pt, rings) {
  if (!inRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(pt, rings[i])) return false;
  return true;
}

function inFeature(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((p) => inPolygon(pt, p));
}

/* Metres between a point and a segment, using a local equirectangular
 * approximation. Adequate at district scale and avoids a geodesy dependency. */
const R_M = 111320;
function segDistM([px, py], [ax, ay], [bx, by]) {
  const k = Math.cos((py * Math.PI) / 180);
  const dx = (bx - ax) * k;
  const dy = by - ay;
  const den = dx * dx + dy * dy;
  let t = den ? ((px - ax) * k * dx + (py - ay) * dy) / den : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * (bx - ax);
  const qy = ay + t * (by - ay);
  const ex = (px - qx) * k;
  const ey = py - qy;
  return Math.sqrt(ex * ex + ey * ey) * R_M;
}

/** Nearest distance from a point to each class present in the sheet. */
function nearestByClass(pt, feats, limitM) {
  const out = {};
  for (const { f, bb } of feats) {
    const c = f.properties.class;
    /* Cheap bbox floor: skip a polygon that cannot beat the current best. */
    const k = Math.cos((pt[1] * Math.PI) / 180);
    const ddx = Math.max(bb[0] - pt[0], 0, pt[0] - bb[2]) * k * R_M;
    const ddy = Math.max(bb[1] - pt[1], 0, pt[1] - bb[3]) * R_M;
    const floor = Math.sqrt(ddx * ddx + ddy * ddy);
    if (floor > limitM || (c in out && floor > out[c])) continue;

    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys)
      for (const ring of poly)
        for (let i = 0; i < ring.length - 1; i++) {
          const d = segDistM(pt, ring[i], ring[i + 1]);
          if (!(c in out) || d < out[c]) out[c] = d;
        }
  }
  const filtered = {};
  for (const [c, d] of Object.entries(out)) if (d <= limitM) filtered[c] = Math.round(d);
  return filtered;
}

const bboxOf = (geom) => {
  let w = 180, s = 90, e = -180, n = -90;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of polys)
    for (const [x, y] of p[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  return [w, s, e, n];
};

/* ---- load habitations by bundling the data module ---------------------- */

const tmp = join(tmpdir(), 'redzone-sample');
mkdirSync(tmp, { recursive: true });
const bundle = join(tmp, `hab-${process.pid}.mjs`);
await build({
  entryPoints: ['src/data/habitations.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
});
const { HABITATIONS } = await import(`file://${bundle}`);

/* ---- sample ------------------------------------------------------------ */

const result = {};
const stats = {};

for (const sheet of SHEETS) {
  const fc = JSON.parse(readFileSync(sheet.file, 'utf8'));
  const feats = fc.features.map((f) => ({ f, bb: bboxOf(f.geometry) }));
  const counts = {};
  let hit = 0;

  for (const h of HABITATIONS) {
    const [x, y] = h.lngLat;
    let cls = null;
    let fid = null;
    for (const { f, bb } of feats) {
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue; // bbox reject
      if (inFeature([x, y], f.geometry)) {
        cls = f.properties.class;
        fid = f.properties.fid ?? null;
        break;
      }
    }
    if (cls) {
      hit++;
      counts[cls] = (counts[cls] ?? 0) + 1;
      (result[h.id] ??= {})[sheet.key] = { class: cls, fid, insideZone: true };
    } else {
      /* Outside every mapped polygon. Record how far the nearest zone of each
       * class is, so the panel can state "outside mapped zones, nearest High
       * Hazard Zone 551 m" instead of showing nothing. A null here would read
       * as "not assessed", which is not what the sheet says. */
      const near = nearestByClass([x, y], feats, 5000);
      if (Object.keys(near).length) {
        (result[h.id] ??= {})[sheet.key] = { class: null, fid: null, insideZone: false, nearestM: near };
      }
    }
  }
  stats[sheet.key] = { hit, counts };
  console.log(`${sheet.key.padEnd(10)} matched ${hit} habitations`, counts);
}

/* ---- emit -------------------------------------------------------------- */

const body = `/* ============================================================================
 * PUBLISHED CLASS SAMPLES  --  GENERATED FILE, DO NOT EDIT BY HAND
 *
 * Produced by scripts/sample-published.mjs. Each entry is the class the
 * publisher assigns to the ground a habitation stands on, obtained by
 * point-in-polygon against the supplied KSDMA district sheets.
 *
 * These are LIVE values from a real published product. They are displayed
 * ALONGSIDE the placeholder factor model rather than replacing it, so that a
 * disagreement between the two is visible instead of silently resolved.
 *
 * Regenerate with:  node scripts/sample-published.mjs
 * ==========================================================================*/

export interface PublishedSample {
  /** Publisher's own class string, verbatim. Null when the habitation falls
   *  outside every mapped polygon in the sheet. */
  class: string | null;
  /** Source feature id, for cross-reference against the original shapefile. */
  fid: string | null;
  insideZone: boolean;
  /** Only when insideZone is false: metres to the nearest polygon of each
   *  class, within a 5 km search radius. */
  nearestM?: Record<string, number>;
}

export interface PublishedClasses {
  landslide?: PublishedSample;
  flood?: PublishedSample;
}

export const PUBLISHED_SOURCE = {
${SHEETS.map(
  (s) => `  ${s.key}: {
    label: ${JSON.stringify(s.label)},
    source: ${JSON.stringify(s.source)},
    agency: 'Kerala State Disaster Management Authority',
    assessedOn: ${JSON.stringify(s.assessedOn)},
  },`,
).join('\n')}
} as const;

/** Habitation id -> published classes. Absent id means the habitation lies
 *  outside the coverage of every ingested sheet. */
export const PUBLISHED: Record<string, PublishedClasses> = ${JSON.stringify(result, null, 2)};
`;

writeFileSync('src/data/published.ts', body);
console.log(`\nwrote src/data/published.ts — ${Object.keys(result).length} habitations sampled`);
