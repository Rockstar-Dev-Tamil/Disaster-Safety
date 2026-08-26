/* ============================================================================
 * CONTEXT-AWARE ROUTING
 *
 * Not shortest-path. An evacuation route is chosen on three things and length
 * is the least important of them:
 *
 *   SAFETY   what ground the road crosses -- hazard class, adjacent slope,
 *            drainage crossings -- sampled per segment from the same rasters
 *            the zone analysis uses.
 *   TIME     class design speed derated by risk and conditions, not distance.
 *   BLOCKAGE an operator can mark a segment impassable; the plan then resumes
 *            from the last cleared junction rather than replanning from origin.
 *
 * A route is ranked on its WORST segment, then on time. Averaging risk over
 * length would hide a single lethal culvert in 40 km of good road.
 *
 * When nothing clears the risk threshold the answer is not a route. It is
 * "observation required", naming the segments that need eyes on them, because
 * a convoy committed to an unverified class-4 segment is how people die.
 * ==========================================================================*/

import type { TerrainManifest, TerrainStack } from './terrain';
import { haversineKm } from './terrain';

export interface RoadGraph {
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

/** Free-flow design speed by OSM class, km/h. Stated assumption, not survey. */
export const CLASS_SPEED: Record<string, number> = {
  motorway: 60,
  trunk: 50,
  primary: 45,
  secondary: 35,
  tertiary: 25,
};

export type RiskClass = 1 | 2 | 3 | 4;

export interface EdgeRisk {
  /** 0-100. */
  score: number;
  cls: RiskClass;
  /** Metres of this segment inside each landslide hazard class. */
  hazardM: { high: number; medium: number; low: number };
  floodM: number;
  maxSlopeDeg: number;
  /** Minutes at derated speed. */
  minutes: number;
  /** Plain-language drivers, highest first. */
  drivers: string[];
}

export interface RouteSegment {
  edgeIndex: number;
  from: number;
  to: number;
  name: string;
  hw: string;
  km: number;
  risk: EdgeRisk;
}

export interface Route {
  id: number;
  rank: number;
  segments: RouteSegment[];
  km: number;
  minutes: number;
  worstClass: RiskClass;
  worstSegment: RouteSegment | null;
  /** Length-weighted mean risk. Shown, never used to rank. */
  meanRisk: number;
  /** True when every segment clears the acceptable class. */
  acceptable: boolean;
}

export interface RouteParams {
  /** 0 = pure speed, 1 = pure safety. Blends the edge cost. */
  riskAversion: number;
  /** Highest segment class a convoy may be committed to. */
  maxAcceptableClass: RiskClass;
  /** Night operation derates every speed. */
  nightOperation: boolean;
  /** Scales hazard weighting with how wet the ground already is. */
  rainfallFactor: number;
}

export const DEFAULT_ROUTE_PARAMS: RouteParams = {
  riskAversion: 0.6,
  maxAcceptableClass: 2,
  nightOperation: true,
  rainfallFactor: 1,
};

/* --------------------------------------------------------- risk sampling --- */

function sampler(m: TerrainManifest, grid: Uint8Array) {
  const [w, s, e, n] = m.bounds;
  return (lon: number, lat: number) => {
    if (lon < w || lon > e || lat < s || lat > n) return 0;
    const x = Math.round(((lon - w) / (e - w)) * (m.width - 1));
    const y = Math.round(((n - lat) / (n - s)) * (m.height - 1));
    return grid[y * m.width + x];
  };
}

/**
 * Sample every segment against the hazard, flood and slope rasters.
 *
 * Done once per stack, not per route: 6,877 edges against three rasters is
 * cheap, and routing then only reads precomputed numbers.
 */
export function computeEdgeRisk(
  graph: RoadGraph,
  stack: TerrainStack,
  params: RouteParams,
): EdgeRisk[] {
  const m = stack.manifest;
  const ls = sampler(m, stack.grids['landslide']);
  const fl = sampler(m, stack.grids['flood']);
  const sl = sampler(m, stack.grids['slope']);

  return graph.edges.map((edge) => {
    const hazardM = { high: 0, medium: 0, low: 0 };
    let floodM = 0;
    let maxSlopeDeg = 0;
    let sampledM = 0;

    for (let i = 0; i < edge.g.length - 1; i++) {
      const [x1, y1] = edge.g[i];
      const [x2, y2] = edge.g[i + 1];
      const segM = haversineKm([x1, y1], [x2, y2]) * 1000;
      /* Step along at ~50 m so a 100 m cell cannot be skipped. */
      const steps = Math.max(1, Math.ceil(segM / 50));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const lon = x1 + (x2 - x1) * t;
        const lat = y1 + (y2 - y1) * t;
        const part = segM / steps;
        sampledM += part;
        const c = Math.round(ls(lon, lat) / 80);
        if (c === 3) hazardM.high += part;
        else if (c === 2) hazardM.medium += part;
        else if (c === 1) hazardM.low += part;
        if (Math.round(fl(lon, lat) / 80) >= 1) floodM += part;
        const s = sl(lon, lat);
        if (s > maxSlopeDeg) maxSlopeDeg = s;
      }
    }

    /* Exposure is a fraction of the segment, so a short crossing of bad ground
     * is not diluted by a long safe approach.
     *
     * The denominator floors at 100 m -- one analysis cell. Below that a
     * segment is smaller than the raster it is being sampled against, so
     * "80% inside hazard" would be an artifact of cell size rather than a
     * measurement. Without the floor a 3 m stub reads as fully inside hazard,
     * scores class 4, and vetoes an entire route on worst-segment ranking.
     * Using the sampled length rather than the stored rounded length also
     * keeps every fraction at or below 1. */
    const len = Math.max(100, sampledM || edge.m);
    const fHigh = hazardM.high / len;
    const fMed = hazardM.medium / len;
    const fFlood = floodM / len;
    const wet = params.rainfallFactor;

    /* Each component is kept separately so the explanation can be DERIVED from
     * the score rather than written alongside it. An earlier version used
     * metre thresholds for the drivers while the score used length fractions,
     * so the worst segment in the network scored 63.6 and reported "no mapped
     * hazard". A number whose stated reasons do not add up to it is a bug. */
    const parts: Array<{ label: string; value: number }> = [
      {
        label: `${Math.round(hazardM.high)} m inside High Hazard Zone (${Math.round(fHigh * 100)}% of segment)`,
        value: 100 * fHigh * 0.9 * wet,
      },
      {
        label: `${Math.round(hazardM.medium)} m inside Medium Hazard Zone (${Math.round(fMed * 100)}%)`,
        value: 100 * fMed * 0.45 * wet,
      },
      {
        label: `${Math.round(floodM)} m across flood landform (${Math.round(fFlood * 100)}%)`,
        value: 100 * fFlood * 0.5 * wet,
      },
      {
        label: `adjacent slope ${maxSlopeDeg.toFixed(0)}°`,
        value: Math.min(28, Math.max(0, maxSlopeDeg - 25)),
      },
      {
        label: `${edge.hw} carriageway`,
        value: edge.hw === 'tertiary' ? 8 : edge.hw === 'secondary' ? 4 : 0,
      },
    ];
    const score = Math.min(100, parts.reduce((a, p) => a + p.value, 0));

    const cls: RiskClass =
      hazardM.high > 100 || score >= 70 ? 4 : score >= 45 ? 3 : score >= 20 ? 2 : 1;


    const derate =
      (cls === 4 ? 0.45 : cls === 3 ? 0.65 : cls === 2 ? 0.85 : 1) *
      (params.nightOperation ? 0.8 : 1);
    const speed = (CLASS_SPEED[edge.hw] ?? 25) * derate;
    const minutes = (edge.m / 1000 / speed) * 60;

    /* Anything contributing at least a point is named, largest first, so the
     * listed reasons always reconstruct the score. */
    const drivers = parts
      .filter((p) => p.value >= 1)
      .sort((a, b) => b.value - a.value)
      .map((p) => `${p.label} (+${p.value.toFixed(0)})`);
    if (!drivers.length) drivers.push('no mapped hazard or steep ground on this segment');

    return { score, cls, hazardM, floodM, maxSlopeDeg, minutes, drivers };
  });
}

/* ------------------------------------------------------------- routing --- */

interface Adj {
  to: number;
  edge: number;
}

export function buildAdjacency(graph: RoadGraph): Adj[][] {
  const adj: Adj[][] = graph.nodes.map(() => []);
  graph.edges.forEach((e, i) => {
    adj[e.a].push({ to: e.b, edge: i });
    adj[e.b].push({ to: e.a, edge: i });
  });
  return adj;
}

export function nearestNode(graph: RoadGraph, lngLat: [number, number]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const d = haversineKm(graph.nodes[i], lngLat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Cost blends time and risk. riskAversion 0 = fastest, 1 = safest. */
function edgeCost(risk: EdgeRisk, params: RouteParams, penalty: number): number {
  const timeCost = risk.minutes;
  const riskCost = risk.minutes * (risk.score / 20);
  return (timeCost * (1 - params.riskAversion) + riskCost * params.riskAversion) * penalty;
}

function dijkstra(
  adj: Adj[][],
  risks: EdgeRisk[],
  blocked: Set<number>,
  params: RouteParams,
  penalties: Map<number, number>,
  from: number,
  to: number,
): number[] | null {
  const n = adj.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;

  /* Binary heap keyed on cost. */
  const heap: Array<[number, number]> = [[0, from]];
  const push = (c: number, v: number) => {
    heap.push([c, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };

  while (heap.length) {
    const [c, v] = pop();
    if (done[v]) continue;
    done[v] = 1;
    if (v === to) break;
    for (const { to: w, edge } of adj[v]) {
      if (blocked.has(edge)) continue;
      const nc = c + edgeCost(risks[edge], params, penalties.get(edge) ?? 1);
      if (nc < dist[w]) {
        dist[w] = nc;
        prevEdge[w] = edge;
        prevNode[w] = v;
        push(nc, w);
      }
    }
  }

  if (!done[to] && dist[to] === Infinity) return null;
  const path: number[] = [];
  let cur = to;
  while (cur !== from) {
    const e = prevEdge[cur];
    if (e < 0) return null;
    path.push(e);
    cur = prevNode[cur];
  }
  return path.reverse();
}

function toRoute(
  graph: RoadGraph,
  risks: EdgeRisk[],
  edgeIds: number[],
  from: number,
  params: RouteParams,
  id: number,
): Route {
  const segments: RouteSegment[] = [];
  let cur = from;
  for (const ei of edgeIds) {
    const e = graph.edges[ei];
    const to = e.a === cur ? e.b : e.a;
    segments.push({
      edgeIndex: ei,
      from: cur,
      to,
      name: e.name ?? `${e.hw} (unnamed)`,
      hw: e.hw,
      km: e.m / 1000,
      risk: risks[ei],
    });
    cur = to;
  }
  const km = segments.reduce((a, s) => a + s.km, 0);
  const minutes = segments.reduce((a, s) => a + s.risk.minutes, 0);
  let worst: RouteSegment | null = null;
  for (const s of segments) if (!worst || s.risk.cls > worst.risk.cls) worst = s;
  const meanRisk = km > 0 ? segments.reduce((a, s) => a + s.risk.score * s.km, 0) / km : 0;
  const worstClass = (worst?.risk.cls ?? 1) as RiskClass;
  return {
    id,
    rank: 0,
    segments,
    km,
    minutes,
    worstClass,
    worstSegment: worst,
    meanRisk,
    acceptable: worstClass <= params.maxAcceptableClass,
  };
}

export interface RouteResult {
  routes: Route[];
  /** Segments that must be observed before committing, when nothing clears. */
  observationRequired: RouteSegment[];
  reachable: boolean;
}

/**
 * Best route plus alternates. Alternates come from penalising the edges the
 * previous route used, so they are genuinely different corridors rather than
 * minor variations of one.
 */
export function computeRoutes(
  graph: RoadGraph,
  adj: Adj[][],
  risks: EdgeRisk[],
  blocked: Set<number>,
  params: RouteParams,
  from: number,
  to: number,
  count = 3,
): RouteResult {
  const routes: Route[] = [];
  const penalties = new Map<number, number>();

  for (let i = 0; i < count; i++) {
    const path = dijkstra(adj, risks, blocked, params, penalties, from, to);
    if (!path) break;
    const r = toRoute(graph, risks, path, from, params, i);
    if (routes.some((x) => x.segments.length === r.segments.length && x.km === r.km)) break;
    routes.push(r);
    for (const e of path) penalties.set(e, (penalties.get(e) ?? 1) * 3);
  }

  if (!routes.length) return { routes: [], observationRequired: [], reachable: false };

  /* Rank on worst segment, then time. Never on mean risk.
   *
   * Ids are reassigned to match rank order. They were handed out in the order
   * Dijkstra found paths, so before this the default selection (id 0) could
   * land on rank 2 or 3 -- highlighting an alternate as though it were the
   * chosen route. */
  routes.sort((a, b) => a.worstClass - b.worstClass || a.minutes - b.minutes);
  routes.forEach((r, i) => {
    r.rank = i + 1;
    r.id = i;
  });

  /* If nothing is acceptable, name the segments needing observation: the worst
   * segment of each route, deduplicated. */
  let observationRequired: RouteSegment[] = [];
  if (!routes.some((r) => r.acceptable)) {
    const seen = new Set<number>();
    for (const r of routes) {
      for (const s of r.segments) {
        if (s.risk.cls > params.maxAcceptableClass && !seen.has(s.edgeIndex)) {
          seen.add(s.edgeIndex);
          observationRequired.push(s);
        }
      }
    }
    observationRequired.sort((a, b) => b.risk.score - a.risk.score);
    observationRequired = observationRequired.slice(0, 6);
  }

  return { routes, observationRequired, reachable: true };
}

/**
 * Replan after a blockage, from the last junction the convoy has cleared
 * rather than from origin. The convoy is somewhere; the plan resumes there.
 */
export function replanFrom(
  route: Route,
  blockedEdge: number,
): { resumeNode: number; clearedKm: number } | null {
  let clearedKm = 0;
  for (const s of route.segments) {
    if (s.edgeIndex === blockedEdge) return { resumeNode: s.from, clearedKm };
    clearedKm += s.km;
  }
  return null;
}

export const RISK_COLOR: Record<RiskClass, string> = {
  1: '#4a8f70',
  2: '#b0902a',
  3: '#e08127',
  4: '#ff6b57',
};

export const RISK_LABEL: Record<RiskClass, string> = {
  1: 'Class 1 — commit',
  2: 'Class 2 — commit',
  3: 'Class 3 — escort, daylight only',
  4: 'Class 4 — do not commit',
};
