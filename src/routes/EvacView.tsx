import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import type { Habitation } from '../data/schema';
import { HABITATION_BY_ID, OPERATING_CLOCK } from '../data/habitations';
import { PUBLISHED, PUBLISHED_SOURCE } from '../data/published';
import { TopBar } from '../components/Chrome';
import {
  STAGES,
  aoiAround,
  haversineKm,
  loadTerrain,
  type Stage,
  type StageState,
  type TerrainStack,
} from '../lib/terrain';
import { coord, int, ts } from '../lib/format';
import { BAND_TEXT } from '../lib/severity';
import {
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
  EXCLUSION,
  PERMANENT_RULES,
  analyse,
  ellipseFeature,
  mergeKmForZoom,
  mergeZones,
  shortlist as shortlistFn,
  type Rules,
  type Weights,
  type ZoneResult,
} from '../lib/zones';
import { Block, CountUp, OverlayBox } from '../components/primitives';
import { ExplainDock } from '../components/ExplainDock';
import { WordmarkProgress } from '../components/Wordmark';
import type { Fact, FactBundle } from '../lib/explain';
import { ZonePanel } from '../components/ZonePanel';
import { LongTermPanel } from '../components/LongTermPanel';
import {
  LONG_TERM_WEIGHTS,
  evaluateLongTerm,
  type LongTermResult,
} from '../lib/longterm';
import { RoutePanel } from '../components/RoutePanel';
import {
  DEFAULT_ROUTE_PARAMS,
  RISK_COLOR,
  buildAdjacency,
  computeEdgeRisk,
  computeRoutes,
  nearestNode,
  replanFrom,
  type RouteParams,
  type RouteResult,
} from '../lib/routing';

const RADIUS_KM = 30;

const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function EvacView({ habitationId }: { habitationId: string }) {
  const h = HABITATION_BY_ID.get(habitationId) ?? null;

  const [stages, setStages] = useState<Stage[]>(
    STAGES.map((s) => ({ ...s, state: 'pending' as StageState })),
  );
  const [stack, setStack] = useState<TerrainStack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  /* Map click handlers are registered once at init; this ref keeps them
   * pointing at the current blocking handler without re-registering. */
  const blockRef = useRef<(i: number) => void>(() => {});

  /* Two tiers over one loaded stack. Extraction is shared; the rule set,
   * capacity model and evaluation differ entirely. */
  const [tier, setTier] = useState<'SHORT' | 'LONG'>('SHORT');
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [selected, setSelected] = useState<number | null>(null);
  const [shortlistSize, setShortlistSize] = useState(10);
  const [zoom, setZoom] = useState(10.4);

  /* ------------------------------------------------------------- 3D view --- */
  /* A relief view of the search area. The hazard here is terrain-driven -- the
   * whole short-term rule set is a gradient threshold -- so seeing the ground
   * as ground, with the same colour overlays draped on it, is an analytical
   * view rather than an ornament.
   *
   * Vertical exaggeration is a deliberate distortion and is labelled as one:
   * at x2 a 5-degree slope reads as 10, which is the very threshold the
   * short-term filter turns on. See the readout in the map overlay. */
  const [view3d, setView3d] = useState(false);
  const [exaggeration, setExaggeration] = useState(2);
  const [routeParams, setRouteParams] = useState<RouteParams>(DEFAULT_ROUTE_PARAMS);
  const [blocked, setBlocked] = useState<Set<number>>(new Set());
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [replanNote, setReplanNote] = useState<string | null>(null);

  /* The weighted combination runs here, in the browser, so moving a weight
   * re-scores and re-clusters live. Only the factor surfaces were precomputed. */
  const result: ZoneResult | null = useMemo(() => {
    if (!stack || !h) return null;
    return analyse(stack, h.lngLat, rules, weights, h.population);
  }, [stack, h, rules, weights]);

  /* Permanent tier runs its own extraction: different exclusions produce a
   * different eligible surface, not merely a different ranking over the same
   * one. */
  const longResult: ZoneResult | null = useMemo(() => {
    if (!stack || !h || tier !== 'LONG') return null;
    return analyse(stack, h.lngLat, PERMANENT_RULES, weights, h.population);
  }, [stack, h, tier, weights]);

  const longTerm: LongTermResult | null = useMemo(() => {
    if (!longResult || !stack || !h) return null;
    return evaluateLongTerm(
      longResult.zones,
      stack,
      h.lngLat,
      h.households,
      h.population,
      LONG_TERM_WEIGHTS,
      null,
    );
  }, [longResult, stack, h]);

  /* Level of detail: zoomed out, nearby clusters combine into general areas;
   * zoomed in they separate so an evaluator can judge each patch. */
  const mergeKm = mergeKmForZoom(zoom);
  /** The extraction currently on screen -- short-term and permanent run
   *  different rule sets, so the headline must follow the active tier. */
  const activeResult = tier === 'LONG' ? longResult : result;

  /** Rank badges, rebuilt whenever the shortlist changes. */
  const rankMarkers = useRef<maplibregl.Marker[]>([]);

  const areas = useMemo(() => {
    if (!result || !h || !stack) return [];
    return mergeZones(
      result.zones,
      mergeKm,
      rules,
      weights,
      h.population,
      (stack.manifest.cellMetres * stack.manifest.cellMetres) / 10000,
    );
  }, [result, mergeKm, rules, weights, h, stack]);

  /* ------------------------------------------------------------ routing --- */

  /* Segment risk is sampled once per stack against the hazard, flood and slope
   * rasters. Routing then reads precomputed numbers, so moving a parameter
   * re-costs instantly instead of re-sampling 6,877 edges. */
  const adjacency = useMemo(
    () => (stack ? buildAdjacency(stack.graph) : null),
    [stack],
  );
  const edgeRisks = useMemo(
    () => (stack ? computeEdgeRisk(stack.graph, stack, routeParams) : null),
    [stack, routeParams],
  );

  const selectedZone = useMemo(
    () =>
      selected === null
        ? null
        : (areas.find((z) => z.id === selected || z.memberIds.includes(selected)) ?? null),
    [areas, selected],
  );

  useEffect(() => {
    setSelectedRoute(0);
    setReplanNote(null);
  }, [selected]);

  /* Routing answers "can a convoy reach this site tonight" -- a short-term
   * question. A permanent township is not reached by convoy on the night of
   * the event, so the route overlay and its panel are off on the long-term
   * tier rather than shown and ignored. */
  const routeResult: RouteResult | null = useMemo(() => {
    if (tier !== 'SHORT') return null;
    if (!stack || !adjacency || !edgeRisks || !selectedZone || !h) return null;
    const from = nearestNode(stack.graph, h.lngLat);
    const to = nearestNode(stack.graph, selectedZone.centroid);
    if (from === to) return null;
    return computeRoutes(stack.graph, adjacency, edgeRisks, blocked, routeParams, from, to);
  }, [tier, stack, adjacency, edgeRisks, selectedZone, blocked, routeParams, h]);

  /* Distance from the habitation to the routable network, and from the network
   * to the zone. Real gaps, so they are measured and shown rather than hidden. */
  const offNetwork = useMemo(() => {
    if (!stack || !routeResult || !h || !selectedZone) return null;
    const route = routeResult.routes.find((r) => r.id === selectedRoute) ?? routeResult.routes[0];
    if (!route || !route.segments.length) return null;
    const first = stack.graph.edges[route.segments[0].edgeIndex].g[0];
    const lastG = stack.graph.edges[route.segments[route.segments.length - 1].edgeIndex].g;
    const last = lastG[lastG.length - 1];
    return {
      startKm: haversineKm(h.lngLat, first),
      endKm: haversineKm(last, selectedZone.centroid),
    };
  }, [stack, routeResult, selectedRoute, h, selectedZone]);

  const toggleBlock = (edgeIndex: number) => {
    const route = routeResult?.routes.find((r) => r.id === selectedRoute) ?? routeResult?.routes[0];
    setBlocked((prev) => {
      const next = new Set(prev);
      if (next.has(edgeIndex)) {
        next.delete(edgeIndex);
        setReplanNote(null);
      } else {
        next.add(edgeIndex);
        /* Replan resumes from the last junction already cleared, not from
         * origin -- the convoy is somewhere, and the plan continues from there. */
        const seg = route?.segments.find((s) => s.edgeIndex === edgeIndex);
        const info = route ? replanFrom(route, edgeIndex) : null;
        setReplanNote(
          seg && info
            ? `${seg.name} marked impassable. ${info.clearedKm.toFixed(1)} km already cleared; ` +
                `replanning from the last cleared junction rather than from origin.`
            : 'Segment marked impassable; routes recomputed.',
        );
      }
      return next;
    });
  };
  blockRef.current = toggleBlock;

  const aoi = useMemo(() => (h ? aoiAround(h.lngLat, RADIUS_KM) : null), [h]);

  /* ------------------------------------------------------------- load --- */
  useEffect(() => {
    if (!h) return;
    let cancelled = false;
    const mark = (key: string, state: StageState, note?: string) => {
      if (cancelled) return;
      setStages((prev) => prev.map((s) => (s.key === key ? { ...s, state, note } : s)));
    };

    loadTerrain(mark)
      .then((s) => {
        if (cancelled) return;
        mark('crop', 'active');
        /* Real work, not a fake step: count how much of the stack falls inside
         * the operation radius, which is what the analysis will run over. */
        const inside = (() => {
          if (!aoi) return 0;
          let n = 0;
          const { manifest } = s;
          const [w, so, e, no] = manifest.bounds;
          for (let y = 0; y < manifest.height; y += 2) {
            const lat = no - ((no - so) * y) / (manifest.height - 1);
            if (lat < aoi.south || lat > aoi.north) continue;
            for (let x = 0; x < manifest.width; x += 2) {
              const lon = w + ((e - w) * x) / (manifest.width - 1);
              if (lon < aoi.west || lon > aoi.east) continue;
              if (haversineKm([lon, lat], h.lngLat) <= RADIUS_KM) n += 4;
            }
          }
          return n;
        })();
        const areaKm2 = (inside * s.manifest.cellMetres ** 2) / 1e6;
        mark('crop', 'done', `${int(inside)} cells · ${areaKm2.toFixed(0)} km² within ${RADIUS_KM} km`);
        setStack(s);
        setTimeout(() => !cancelled && setReady(true), 250);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habitationId]);

  /* -------------------------------------------------------------- map --- */
  useEffect(() => {
    if (!ready || !h || !stack || !holder.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: holder.current,
      style: {
        version: 8,
        sources: {
          hillshade: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 14,
            attribution: 'Hillshade: Esri · Roads: OpenStreetMap · Hazard: KSDMA',
          },
          /* Local terrarium DEM -- drives both the 3D mesh and, in 3D, the
           * shading. Built by scripts/build-dem-tiles.py from the same
           * Copernicus GLO-30 data the slope layer comes from, so relief and
           * gradient can never disagree. No network. */
          dem: {
            type: 'raster-dem',
            tiles: ['/dem/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            minzoom: 8,
            maxzoom: 12,
            attribution: 'Elevation: Copernicus GLO-30',
          },
        },
        layers: [
          { id: 'ground', type: 'background', paint: { 'background-color': '#05070a' } },
          {
            id: 'hillshade',
            type: 'raster',
            source: 'hillshade',
            paint: {
              'raster-opacity': 0.4,
              'raster-saturation': -1,
              'raster-contrast': 0.4,
              'raster-brightness-max': 0.45,
            },
          },
          /* Off in 2D. The Esri raster is PRE-shaded imagery: draping it over
           * a 3D mesh shades the terrain twice, once baked and once by the
           * camera, and hillsides end up muddy. In 3D we hide that raster and
           * shade from the DEM instead. */
          {
            id: 'hillshade-local',
            type: 'hillshade',
            source: 'dem',
            layout: { visibility: 'none' },
            paint: {
              'hillshade-exaggeration': 0.55,
              'hillshade-shadow-color': '#05070a',
              'hillshade-highlight-color': '#8c949e',
              'hillshade-accent-color': '#05070a',
            },
          },
        ],
      },
      center: h.lngLat,
      zoom: 10.4,
      maxZoom: 16,
      minZoom: 8,
      attributionControl: { compact: true },
      /* Enabled for the 3D view; a pitched camera without bearing control is
       * frustrating to read. Left off in 2D via the toggle below. */
      dragRotate: true,
      maxPitch: 75,
      fadeDuration: 0,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 130, unit: 'metric' }), 'bottom-right');

    map.on('load', async () => {
      const [ls, fl] = await Promise.all([
        fetch('/layers/wayanad-landslide.geojson').then((r) => r.json()),
        fetch('/layers/wayanad-flood.geojson').then((r) => r.json()),
      ]);

      map.addSource('flood', { type: 'geojson', data: fl });
      map.addLayer({
        id: 'flood-fill',
        type: 'fill',
        source: 'flood',
        paint: {
          'fill-color': ['match', ['get', 'class'], 'Waterbody', '#1f4e63', '#3b7ea1'],
          'fill-opacity': 0.45,
        },
      });

      map.addSource('landslide', { type: 'geojson', data: ls });
      map.addLayer({
        id: 'ls-fill',
        type: 'fill',
        source: 'landslide',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'High Hazard Zone', '#e08127',
            'Medium Hazard Zone', '#b0902a',
            '#3f7a34',
          ],
          'fill-opacity': 0.5,
        },
      });
      map.addLayer({
        id: 'ls-line',
        type: 'line',
        source: 'landslide',
        paint: { 'line-color': '#05070a', 'line-width': 0.5, 'line-opacity': 0.5 },
      });

      map.addSource('roads', { type: 'geojson', data: stack.roads });
      map.addLayer({
        id: 'roads-casing',
        type: 'line',
        source: 'roads',
        paint: {
          'line-color': '#05070a',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'hw'], 'motorway', 2.2, 'trunk', 2.0, 'primary', 1.6, 'secondary', 1.1, 0.6],
            14, ['match', ['get', 'hw'], 'motorway', 9, 'trunk', 8, 'primary', 6.5, 'secondary', 4.5, 2.6],
          ],
        },
      });
      map.addLayer({
        id: 'roads-line',
        type: 'line',
        source: 'roads',
        paint: {
          'line-color': [
            'match',
            ['get', 'hw'],
            'motorway', '#c8d2dc',
            'trunk', '#c8d2dc',
            'primary', '#aab6c2',
            'secondary', '#8d99a6',
            '#6d7883',
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'hw'], 'motorway', 1.2, 'trunk', 1.1, 'primary', 0.9, 'secondary', 0.6, 0.35],
            14, ['match', ['get', 'hw'], 'motorway', 6, 'trunk', 5.2, 'primary', 4, 'secondary', 2.8, 1.5],
          ],
        },
      });

      /* Origin, and the operation radius the analysis will run inside. */
      map.addSource('aoi', {
        type: 'geojson',
        data: circle(h.lngLat, RADIUS_KM),
      });
      map.addLayer({
        id: 'aoi-line',
        type: 'line',
        source: 'aoi',
        paint: { 'line-color': '#4d9fd6', 'line-width': 1, 'line-dasharray': [3, 3] },
      });

      map.addSource('origin', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: h.lngLat } },
      });
      map.addLayer({
        id: 'origin-halo',
        type: 'circle',
        source: 'origin',
        paint: {
          'circle-radius': 13,
          'circle-color': 'transparent',
          'circle-stroke-color': '#ff7563',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'origin-dot',
        type: 'circle',
        source: 'origin',
        paint: { 'circle-radius': 5, 'circle-color': '#ff7563', 'circle-stroke-color': '#05070a', 'circle-stroke-width': 1.5 },
      });
    });

    map.on('load', () => {
      map.addSource('eligible', {
        type: 'image',
        url: TRANSPARENT_PX,
        coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]],
      });
      map.addLayer({
        id: 'eligible-layer',
        type: 'raster',
        source: 'eligible',
        paint: { 'raster-opacity': 0, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
      });

      /* Route rendering. Segment colour IS the risk class, so an officer sees
       * why a corridor was avoided without reading the panel. */
      map.addSource('routes', { type: 'geojson', data: EMPTY_FC });
      /* Three layers. The wide glow carries RISK (colour = class), the dark
       * casing separates it from the basemap, and the bright core says "this
       * is the chosen route" -- so risk stays encoded while the route itself
       * is unmistakable against green zones and orange hazard. */
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'primary'], 18, 6],
          'line-opacity': ['case', ['get', 'primary'], 0.6, 0.25],
          'line-blur': 4,
        },
      });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#05070a',
          'line-width': ['case', ['==', ['get', 'primary'], true], 10, 4],
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'blocked'], true], '#ff3b28',
            ['==', ['get', 'primary'], true], '#7fe9ff',
            ['get', 'color'],
          ],
          'line-width': ['case', ['==', ['get', 'primary'], true], 6, 2],
          'line-opacity': [
            'case',
            ['get', 'primary'], ['coalesce', ['feature-state', 'reveal'], 1],
            ['*', 0.5, ['coalesce', ['feature-state', 'reveal'], 1]],
          ],
        },
      });
      /* line-dasharray takes no data expression in MapLibre, so the blocked
       * case cannot be a `case` on the shared layer -- it silently threw and
       * blocked segments rendered solid. Separate layer, static dash, filter. */
      map.addLayer({
        id: 'route-blocked',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'blocked'], true],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#ff3b28',
          'line-width': ['case', ['==', ['get', 'primary'], true], 6, 2],
          'line-dasharray': [1.5, 1.5],
        },
      });
      map.on('click', 'route-line', (e) => {
        const f = e.features?.[0];
        if (f && f.properties && f.properties.edgeIndex !== undefined) {
          blockRef.current(Number(f.properties.edgeIndex));
        }
      });
      map.on('mouseenter', 'route-line', () => {
        map.getCanvas().style.cursor = 'crosshair';
      });
      map.on('mouseleave', 'route-line', () => {
        map.getCanvas().style.cursor = '';
      });

      /* The mapped network is tertiary-and-above, so the first and last legs
       * into a hamlet or a candidate zone are usually off it. Drawn dashed and
       * called out in the panel rather than left as an unexplained gap. */
      map.addSource('connector', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'connector-line',
        type: 'line',
        source: 'connector',
        paint: {
          'line-color': '#66e0ff',
          'line-width': 2,
          'line-opacity': 0.7,
          'line-dasharray': [2, 2],
        },
      });

      map.addSource('zones', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': ['case', ['get', 'selected'], '#4d9fd6', '#a8d98a'],
          'fill-opacity': [
            'case',
            ['get', 'selected'], 0.3,
            ['get', 'shortlisted'], 0.16,
            0.05,
          ],
        },
      });
      map.addLayer({
        id: 'zone-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': [
            'case',
            ['get', 'selected'], '#cfe8f7',
            ['get', 'shortlisted'], '#dfe6ec',
            '#7d858f',
          ],
          'line-width': [
            'case',
            ['get', 'selected'], 1.6,
            ['get', 'shortlisted'], 1,
            0.6,
          ],
          /* Solid, but thin and only partly opaque. The ellipse is a second
           * moment, not a surveyed boundary; a crisp bright outline would
           * claim a precision a 100 m grid does not have. */
          'line-opacity': [
            'case',
            ['get', 'selected'], 1,
            ['get', 'shortlisted'], 0.8,
            0.28,
          ],
        },
      });
      map.addSource('zone-pts', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'zone-dot',
        type: 'circle',
        source: 'zone-pts',
        paint: {
          'circle-radius': ['case', ['get', 'shortlisted'], 0, ['get', 'selected'], 0, 1.8],
          'circle-color': [
            'case',
            ['get', 'selected'], '#8fc6ea',
            ['get', 'shortlisted'], '#0f1620',
            '#6e8a5e',
          ],
          'circle-stroke-color': [
            'case',
            ['get', 'selected'], '#cfe8f7',
            ['get', 'shortlisted'], '#a8d98a',
            '#6e8a5e',
          ],
          'circle-stroke-width': ['case', ['get', 'shortlisted'], 1.1, 0.8],
        },
      });

      map.on('click', 'zone-fill', (e) => {
        const f = e.features?.[0];
        if (f) setSelected(Number(f.properties?.id));
      });
      map.on('mouseenter', 'zone-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'zone-fill', () => { map.getCanvas().style.cursor = ''; });
      setMapReady(true);
    });
    map.on('zoom', () => setZoom(map.getZoom()));

    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__map = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [ready, h, stack]);

  /* ------------------------------------------------- draw the analysis --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !result) return;

    /* Suitability surface, painted to a canvas and georeferenced. Excluded
     * cells are left transparent -- the hazard polygons underneath already say
     * why, and a grey blanket would hide them. */
    const active = tier === 'LONG' && longResult ? longResult : result;
    const { crop, reason, score } = active;
    const cv = document.createElement('canvas');
    cv.width = crop.w;
    cv.height = crop.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(crop.w, crop.h);
    for (let i = 0; i < crop.w * crop.h; i++) {
      const p = i * 4;
      if (reason[i] !== EXCLUSION.NONE) continue;
      const t = score[i] / 100;
      img.data[p] = 40 + t * 130;
      img.data[p + 1] = 120 + t * 110;
      img.data[p + 2] = 70 + t * 40;
      img.data[p + 3] = 90 + t * 110;
    }
    ctx.putImageData(img, 0, 0);
    const [w0, s0, e0, n0] = crop.bounds;
    (map.getSource('eligible') as maplibregl.ImageSource).updateImage({
      url: cv.toDataURL(),
      coordinates: [[w0, n0], [e0, n0], [e0, s0], [w0, s0]],
    });
    /* Dial the eligible surface back as it covers more of the view: at 15% it
     * is a sparse finding worth showing boldly, at 51% it is a background the
     * candidate outlines have to sit on top of. */
    const pct = (tier === 'LONG' ? longResult : result)?.stats.eligiblePct ?? 0;
    map.setPaintProperty('eligible-layer', 'raster-opacity', pct > 35 ? 0.42 : 0.85);

    /* Every cluster above the size floor gets an ellipse. The shortlist is a
     * ranking, not a filter on what exists -- an officer scanning the map has
     * to see the large uncircled patch rather than wonder why it is missing. */
    /* Badge numbers must be the numbers the panel prints. The long-term tier
     * re-ranks zones through its own RFCTLARR/Cernea evaluation, so a zone
     * sitting at raw rank 105 can be candidate #1 -- showing the raw rank on
     * the map put a "105" beside the row the panel calls "#1". */
    const displayRank = new Map<number, number>();
    let short: Set<number>;
    if (tier === 'LONG' && longTerm) {
      const top = longTerm.candidates.slice(0, 12);
      top.forEach((c, i) => displayRank.set(c.zone.id, i + 1));
      short = new Set(top.map((c) => c.zone.id));
    } else {
      const picked = shortlistFn(areas, shortlistSize, rules.minSeparationKm);
      picked.forEach((p, i) => displayRank.set(p.zone.id, i + 1));
      short = new Set(picked.map((p) => p.zone.id));
    }
    const shown = tier === 'LONG' && longResult ? longResult.zones : areas;
    /* A zone selected at high zoom is folded into an area with a different id
     * once merging kicks in. Resolve through membership so the highlight and
     * the panel card survive a zoom change. */
    const isSel = (z: (typeof shown)[number]) =>
      selected !== null && (z.id === selected || z.memberIds.includes(selected));

    const feats = shown.map((z) => {
      const f = ellipseFeature(z, isSel(z));
      (f.properties as Record<string, unknown>).shortlisted = short.has(z.id);
      return f;
    });
    (map.getSource('zones') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: feats,
    });
    (map.getSource('zone-pts') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: shown.map((z) => ({
        type: 'Feature' as const,
        properties: {
          id: z.id,
          rank: displayRank.get(z.id) ?? z.rank,
          selected: isSel(z),
          shortlisted: short.has(z.id),
        },
        geometry: { type: 'Point' as const, coordinates: z.centroid },
      })),
    });

    /* Rank badges are HTML markers, not a symbol layer: the map style carries
     * no `glyphs` endpoint, and pointing at a remote one would put a network
     * dependency in front of the rank numbers at demo time. As markers they
     * also inherit the app's own mono face instead of a webfont. */
    for (const m of rankMarkers.current) m.remove();
    rankMarkers.current = shown
      .filter((z) => short.has(z.id))
      .map((z) => {
        const el = document.createElement('div');
        el.className = `zbadge${isSel(z) ? ' sel' : ''}`;
        const r = displayRank.get(z.id) ?? z.rank;
        el.textContent = String(r);
        el.title = `#${r} — ${Math.round(z.areaHa)} ha`;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setSelected(z.id);
        });
        return new maplibregl.Marker({ element: el }).setLngLat(z.centroid).addTo(map);
      });
  }, [result, longResult, longTerm, tier, areas, selected, mapReady, shortlistSize, rules.minSeparationKm]);

  /* ------------------------------------------------------ explain scope --- */
  /* Assembled from what the panel is DISPLAYING, not from the underlying
   * result objects. If a figure is not on screen it must not be in the bundle,
   * because the bundle is the complete set of things an answer is permitted to
   * cite -- and, once the model is wired in, the only context it is given. */
  const explainBundle: FactBundle | undefined = useMemo(() => {
    if (!activeResult || !h) return undefined;
    const st = activeResult.stats;
    const shown = tier === 'LONG' ? activeResult.zones : areas;
    const top = shown[0];
    const facts: Fact[] = [
      { key: 'habitation', label: 'Habitation', value: h.name },
      { key: 'tier', label: 'Tier', value: tier === 'LONG' ? 'long-term, permanent' : 'short-term, transitional camp' },
      { key: 'population', label: 'Population to move', value: int(h.population), aka: ['people', 'persons'] },
      { key: 'households', label: 'Households', value: int(h.households) },
      { key: 'radius', label: 'Operation radius', value: `${RADIUS_KM} km`, aka: ['search', 'area'] },
      { key: 'eligible-ha', label: 'Eligible ground', value: `${int(Math.round(st.eligibleHa))} ha`, aka: ['passed', 'filter', 'land'] },
      { key: 'eligible-pct', label: 'Eligible share of search area', value: `${st.eligiblePct.toFixed(1)}%`, aka: ['percent', 'proportion'] },
      { key: 'candidates', label: 'Candidate zones', value: int(shown.length), aka: ['sites', 'options', 'zones'] },
      { key: 'slope-rule', label: 'Maximum ground gradient', value: `${rules.maxSlopeDeg}°`, aka: ['slope', 'steep', 'gradient'] },
      { key: 'landslide-rule', label: 'Maximum landslide class admitted', value: String(rules.maxLandslideClass), aka: ['hazard', 'susceptibility'] },
      { key: 'floor', label: 'Minimum zone area', value: `${rules.minZoneHa} ha`, aka: ['floor', 'smallest'] },
      { key: 'grid', label: 'Analysis grid', value: `${stack?.manifest.cellMetres ?? 100} m`, aka: ['resolution', 'cell'] },
    ];
    if (top) {
      facts.push(
        {
          key: 'top-name',
          label: 'Top-ranked candidate',
          /* nearestTown is {name, km}, not a string -- interpolating it whole
           * printed "[object Object]" into an answer. */
          value: top.nearestTown
            ? `near ${top.nearestTown.name}, ${top.nearestTown.km.toFixed(1)} km from it`
            : 'unnamed ground, no settlement within range',
          aka: ['first', 'best', 'rank', 'closest', 'nearest'],
        },
        { key: 'top-area', label: 'Top candidate area', value: `${Math.round(top.areaHa)} ha` },
        {
          key: 'top-dist',
          label: 'Top candidate distance from origin',
          value: `${top.distOriginKm.toFixed(1)} km`,
          aka: ['closest', 'nearest', 'far', 'distance', 'away'],
        },
        { key: 'top-score', label: 'Top candidate score', value: top.score.toFixed(0), aka: ['ranked', 'ranking'] },
      );
    }
    if (selectedZone) {
      facts.push(
        {
          key: 'sel-name',
          label: 'Selected zone',
          value: selectedZone.nearestTown
            ? `near ${selectedZone.nearestTown.name}`
            : 'unnamed ground',
          aka: ['selected', 'chosen'],
        },
        { key: 'sel-area', label: 'Selected zone area', value: `${Math.round(selectedZone.areaHa)} ha`, aka: ['selected', 'chosen'] },
        { key: 'sel-capacity', label: 'Selected zone capacity', value: `${int(selectedZone.capacityPersons)} persons`, aka: ['capacity', 'hold', 'fit'] },
      );
    }
    if (routeResult && routeResult.routes.length) {
      const r = routeResult.routes.find((x) => x.id === selectedRoute) ?? routeResult.routes[0];
      facts.push(
        { key: 'route-km', label: 'Selected route distance', value: `${r.km.toFixed(1)} km`, aka: ['route', 'distance', 'far'] },
        { key: 'route-min', label: 'Selected route arrival', value: `${Math.round(r.minutes)} min`, aka: ['time', 'arrival', 'long'] },
        { key: 'route-worst', label: 'Worst segment class on that route', value: `class ${r.worstClass}`, aka: ['risk', 'worst', 'safe', 'danger'] },
      );
    }
    return {
      scope: 'EVAC_ZONES' as const,
      subject: `${h.name}, ${tier === 'LONG' ? 'long-term' : 'short-term'} tier`,
      facts,
    };
  }, [activeResult, areas, tier, h, rules, stack, selectedZone, routeResult, selectedRoute]);

  /* ------------------------------------------------------ terrain on/off --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (view3d) {
      map.setTerrain({ source: 'dem', exaggeration });
      map.setLayoutProperty('hillshade', 'visibility', 'none');
      map.setLayoutProperty('hillshade-local', 'visibility', 'visible');
      map.easeTo({ pitch: 62, duration: 900, essential: true });
      map.dragRotate.enable();
    } else {
      map.setTerrain(null);
      map.setLayoutProperty('hillshade', 'visibility', 'visible');
      map.setLayoutProperty('hillshade-local', 'visibility', 'none');
      map.easeTo({ pitch: 0, bearing: 0, duration: 900, essential: true });
      map.dragRotate.disable();
    }
  }, [view3d, mapReady]);

  /* Exaggeration alone does not need a camera move. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !view3d) return;
    map.setTerrain({ source: 'dem', exaggeration });
  }, [exaggeration, view3d, mapReady]);

  /* --------------------------------------------------- draw the routes --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('routes') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!routeResult || !stack) {
      src.setData(EMPTY_FC);
      return;
    }
    const feats: GeoJSON.Feature[] = [];
    /* Alternates draw first so the chosen route sits on top of them. */
    for (const r of [...routeResult.routes].reverse()) {
      for (const s of r.segments) {
        feats.push({
          type: 'Feature',
          properties: {
            edgeIndex: s.edgeIndex,
            color: blocked.has(s.edgeIndex) ? '#ff5f4d' : RISK_COLOR[s.risk.cls],
            primary: r.id === selectedRoute,
            blocked: blocked.has(s.edgeIndex),
          },
          geometry: { type: 'LineString', coordinates: stack.graph.edges[s.edgeIndex].g },
        });
      }
    }
    src.setData({ type: 'FeatureCollection', features: feats });

    const conn = map.getSource('connector') as maplibregl.GeoJSONSource | undefined;
    const route = routeResult.routes.find((r) => r.id === selectedRoute);
    if (conn && route && route.segments.length && h && selectedZone) {
      const first = stack.graph.edges[route.segments[0].edgeIndex].g[0];
      const lastSeg = route.segments[route.segments.length - 1];
      const lastG = stack.graph.edges[lastSeg.edgeIndex].g;
      const last = lastG[lastG.length - 1];
      conn.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [h.lngLat, first] } },
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [last, selectedZone.centroid] } },
        ],
      });
    } else if (conn) {
      conn.setData(EMPTY_FC);
    }
  }, [routeResult, selectedRoute, blocked, mapReady, stack, h, selectedZone]);

  /* Fly to a selection ONCE, when the selection itself changes.
   *
   * This effect also depends on `areas`, which recomputes on every zoom change
   * because merging is zoom-driven. Without the guard, zooming out re-fires it
   * and easeTo yanks the map straight back to 12.5 -- the zoom controls appear
   * dead while anything is selected. */
  const flownTo = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (selected === null) {
      flownTo.current = null;
      return;
    }
    if (flownTo.current === selected) return;
    const z = areas.find((x) => x.id === selected || x.memberIds.includes(selected));
    if (!z || !h) return;

    /* Frame origin, zone AND the route. Flying to the zone centroid at 12.5
     * put a 15 km route almost entirely off-screen -- the route was drawn but
     * not visible, which reads as "routing does not work". */
    let w = Math.min(h.lngLat[0], z.centroid[0]);
    let e = Math.max(h.lngLat[0], z.centroid[0]);
    let so = Math.min(h.lngLat[1], z.centroid[1]);
    let no = Math.max(h.lngLat[1], z.centroid[1]);
    const route = routeResult?.routes.find((r) => r.id === selectedRoute) ?? routeResult?.routes[0];
    if (route && stack) {
      for (const seg of route.segments) {
        for (const [lon, lat] of stack.graph.edges[seg.edgeIndex].g) {
          if (lon < w) w = lon;
          if (lon > e) e = lon;
          if (lat < so) so = lat;
          if (lat > no) no = lat;
        }
      }
    } else {
      return; // wait for the route before framing
    }
    flownTo.current = selected;
    map.fitBounds([w, so, e, no], {
      padding: 90,
      duration: 800, // matches --t-camera
      maxZoom: 13,
      essential: true,
    });
  }, [selected, areas, mapReady, routeResult, selectedRoute, h, stack]);

  if (!h) {
    return (
      <>
        <TopBar onShowKeys={() => {}} />
        <div className="empty">
          <strong>Unknown habitation</strong>
          No habitation with id {habitationId}.{' '}
          <a className="inline" href="#/map">
            Return to the red zone map
          </a>
        </div>
      </>
    );
  }

  const pub = PUBLISHED[h.id];

  return (
    <>
      <TopBar onShowKeys={() => {}} />

      {!ready ? (
        <LoadScreen h={h} stages={stages} error={error} />
      ) : (
        <div className="evacview">
          <div className="mapstage">
            <div ref={holder} className="mapcanvas" />

            <div className="map-overlay map-scale">
              <div className="zoomctx">
                <div className="zoomctx-row">
                  <span className="lod">{h.name}</span>
                  <span className="mono">{coord(h.lngLat)}</span>
                </div>
                <div className="zoomctx-row">
                  <span>View</span>
                  <span className="seg seg-xs">
                    <button className={view3d ? '' : 'on'} onClick={() => setView3d(false)}>
                      Plan
                    </button>
                    <button className={view3d ? 'on' : ''} onClick={() => setView3d(true)}>
                      Relief
                    </button>
                  </span>
                </div>
                <div className="zoomctx-row">
                  <span>Operation radius</span>
                  <span className="mono">{RADIUS_KM} km</span>
                </div>
                <div className="zoomctx-row">
                  <span>Grid</span>
                  <span className="mono">{stack?.manifest.cellMetres} m</span>
                </div>
                <div className="zoomctx-row">
                  <span>{mergeKm > 0 ? 'Zones merged within' : 'Zones'}</span>
                  <span className="mono">
                    {mergeKm > 0 ? `${mergeKm.toFixed(1)} km` : 'individual'}
                  </span>
                </div>
                {view3d ? (
                  <>
                    <div className="zoomctx-row">
                      <span>Vertical</span>
                      <span className="mono">&times;{exaggeration.toFixed(1)}</span>
                    </div>
                    <input
                      className="inp"
                      type="range"
                      min={1}
                      max={3}
                      step={0.5}
                      value={exaggeration}
                      onChange={(e) => setExaggeration(Number(e.target.value))}
                      aria-label="Vertical exaggeration"
                    />
                    {/* The distortion is stated, not implied. At x2 a 5-degree
                        slope -- the short-term gradient limit -- renders as 10,
                        so the relief view must never be read as evidence about
                        the very threshold that admitted the ground. */}
                    {exaggeration > 1 ? (
                      <div className="exagwarn">
                        Heights exaggerated &times;{exaggeration.toFixed(1)} for legibility.
                        Visual only — do not judge gradient from this view.
                      </div>
                    ) : (
                      <div className="exagnote">True vertical scale.</div>
                    )}
                  </>
                ) : null}
              </div>
            </div>

            <div className="map-overlay map-legend">
              <OverlayBox title="Constraint layers">
                <div>
              {[
                ['High Hazard Zone', '#e08127'],
                ['Medium Hazard Zone', '#b0902a'],
                ['Low Hazard Zone', '#3f7a34'],
                ['Flood plain', '#3b7ea1'],
                ['Waterbody', '#1f4e63'],
              ].map(([label, color]) => (
                <div className="legend-row" key={label}>
                  <span style={{ width: 12, height: 9, background: color, display: 'block' }} />
                  <span className="lbl">{label}</span>
                </div>
              ))}
              {selectedZone && tier === 'SHORT' ? (
                <>
                  <div className="legend-title" style={{ marginTop: 'var(--s-3)' }}>
                    Segment risk
                  </div>
                  {([1, 2, 3, 4] as const).map((c) => (
                    <div className="legend-row" key={c}>
                      <span style={{ width: 14, height: 3, background: RISK_COLOR[c], display: 'block' }} />
                      <span className="lbl">
                        {c === 4 ? 'Do not commit' : c === 3 ? 'Escort, daylight' : 'Commit'}
                      </span>
                      <span className="rng">c{c}</span>
                    </div>
                  ))}
                  <div className="legend-note" style={{ marginBottom: 'var(--s-3)' }}>
                    Click any route segment on the map to mark it impassable.
                  </div>
                </>
              ) : null}
              <div className="legend-note">
                KSDMA sheets at 1:50,000 — boundaries good to 50–100 m. Not parcel-accurate.
              </div>
                </div>
              </OverlayBox>
            </div>
          </div>

          <aside className="evacpanel">
            <div className="panel-head">
              <div className="panel-head-top">
                <div>
                  <div className="panel-title">{h.name}</div>
                  <div className="panel-breadcrumb">
                    {h.block} block · {h.district} · {h.state}
                  </div>
                </div>
                <a className="panel-close" href="#/map" title="Back to red zone map">
                  ×
                </a>
              </div>
              {/* The decision number on THIS screen is how much ground passed
                * the filter -- not the hazard score, which is why the officer
                * is already here. It counts when a rule slider moves, which is
                * the visible confirmation that the overlay re-ran. */}
              <div className="headline">
                <div className="headline-main">
                  <div className="headline-label">Eligible ground</div>
                  <div className="headline-num">
                    {activeResult ? (
                      <CountUp value={Math.round(activeResult.stats.eligibleHa)} suffix="ha" />
                    ) : (
                      <span className="fg-3">—</span>
                    )}
                  </div>
                </div>
                <div className="headline-side">
                  <div className="hs-row">
                    <span>of search area</span>
                    <span className="mono">
                      {activeResult ? `${activeResult.stats.eligiblePct.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                  <div className="hs-row">
                    <span>candidate zones</span>
                    <span className="mono">
                      {activeResult ? int(tier === 'LONG' ? activeResult.zones.length : areas.length) : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="metarow">
                <span className="mi">
                  <span className="mi-k">Pop</span>
                  <span className="mi-v mono">{int(h.population)}</span>
                </span>
                <span className="mi">
                  <span className="mi-k">Households</span>
                  <span className="mi-v mono">{int(h.households)}</span>
                </span>
                <span className="mi">
                  <span className="mi-k">Susceptibility</span>
                  <span className="mi-v mono" style={{ color: BAND_TEXT[h.susceptibility.band] }}>
                    {h.susceptibility.score.toFixed(1)}
                  </span>
                </span>
                <span className="mi">
                  <span className="mi-k">Current</span>
                  <span className="mi-v mono">{h.current.score.toFixed(1)}</span>
                </span>
              </div>
            </div>

            <div className="tierstrip">
              <button
                className={`tiertab${tier === 'SHORT' ? ' on' : ''}`}
                onClick={() => { setTier('SHORT'); setSelected(null); }}
              >
                <span className="tiertab-top">
                  <span className="tiertab-name">Short-term</span>
                </span>
                <span className="tiertab-status" style={{ color: 'var(--fg-2)' }}>
                  transitional camp · Sphere
                </span>
              </button>
              <button
                className={`tiertab${tier === 'LONG' ? ' on' : ''}`}
                onClick={() => { setTier('LONG'); setSelected(null); }}
              >
                <span className="tiertab-top">
                  <span className="tiertab-name">Long-term</span>
                </span>
                <span className="tiertab-status" style={{ color: 'var(--fg-2)' }}>
                  permanent · RFCTLARR
                </span>
              </button>
            </div>

            <div className="panel-body">
              <Block title="Search area" aux={`${RADIUS_KM} km radius`} collapsible flush>
                <div className="block-body">
                  <dl className="kv">
                    <dt>Analysis grid</dt>
                    <dd className="mono">
                      {stack?.manifest.width} × {stack?.manifest.height} at{' '}
                      {stack?.manifest.cellMetres} m
                    </dd>
                    <dt>Road network</dt>
                    <dd className="mono">{int(stack?.roads.features.length ?? 0)} ways</dd>
                    <dt>Settlements</dt>
                    <dd className="mono">{int(stack?.manifest.towns.length ?? 0)}</dd>
                    <dt>Facilities</dt>
                    <dd className="mono">{int(stack?.manifest.facilities.length ?? 0)}</dd>
                  </dl>
                </div>
              </Block>

              {pub ? (
                <Block
                  title="Published class at origin"
                  aux={
                    pub.landslide?.insideZone ? pub.landslide.class : 'outside mapped zones'
                  }
                  collapsible
                  flush
                >
                  <div className="block-body">
                    <dl className="kv">
                      {(['landslide', 'flood'] as const).map((k) =>
                        pub[k] ? (
                          <div key={k} style={{ display: 'contents' }}>
                            <dt>{PUBLISHED_SOURCE[k].label}</dt>
                            <dd>
                              {pub[k]!.insideZone
                                ? pub[k]!.class
                                : 'Outside mapped zones'}
                            </dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  </div>
                </Block>
              ) : null}

              {tier === 'LONG' ? (
                longTerm && longResult ? (
                  <LongTermPanel
                    h={h}
                    result={longTerm}
                    weights={LONG_TERM_WEIGHTS}
                    selected={selected}
                    onSelect={setSelected}
                    eligiblePct={longResult.stats.eligiblePct}
                  />
                ) : (
                  <div className="empty" style={{ padding: 'var(--s-5)' }}>
                    Running permanent-tier analysis...
                  </div>
                )
              ) : result ? (
                <ZonePanel
                  h={h}
                  result={result}
                  areas={areas}
                  mergeKm={mergeKm}
                  zoom={zoom}
                  rules={rules}
                  setRules={setRules}
                  weights={weights}
                  setWeights={setWeights}
                  selected={selected}
                  onSelect={setSelected}
                  shortlistSize={shortlistSize}
                  setShortlistSize={setShortlistSize}
                />
              ) : null}

              {selectedZone && tier === 'SHORT' ? (
                <RoutePanel
                  zone={selectedZone}
                  result={routeResult}
                  params={routeParams}
                  setParams={setRouteParams}
                  blocked={blocked}
                  onToggleBlock={toggleBlock}
                  selectedRoute={selectedRoute}
                  onSelectRoute={setSelectedRoute}
                  replanNote={replanNote}
                  offNetwork={offNetwork}
                />
              ) : null}
            </div>

            {/* Docked at the foot of the panel, so the transcript grows upward
                over the panel rather than pushing the tables it cites out of
                view. */}
            <ExplainDock scope="EVAC_ZONES" bundle={explainBundle} />

            <div className="provline">
              <span className="src">Picture as of</span>
              <div className="mono">{ts(OPERATING_CLOCK)}</div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function circle([lon, lat]: [number, number], km: number): GeoJSON.Feature {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    pts.push([
      lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a),
      lat + (km / 111.32) * Math.sin(a),
    ]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

/* -------------------------------------------------------------- loader --- */

function LoadScreen({
  h,
  stages,
  error,
}: {
  h: Habitation;
  stages: Stage[];
  error: string | null;
}) {
  const done = stages.filter((s) => s.state === 'done').length;
  return (
    <div className="loadscreen">
      <div className="loadscreen-inner">
        {/* The wordmark IS the progress indicator -- the letterforms fill left
            to right as stages complete, rather than a bar running beside a
            logo. One object, not two. */}
        <div className="loadmark">
          <WordmarkProgress progress={done / stages.length} height={48} />
        </div>

        <div className="loadscreen-head">
          <span>Preparing evacuation planning</span>
          <span className="mono">
            {done} / {stages.length}
          </span>
        </div>
        <div className="loadscreen-sub">
          {h.name} · {h.block} block · {h.district} · {RADIUS_KM} km operation radius
        </div>

        <table className="loadtable">
          <tbody>
            {stages.map((s) => (
              <tr key={s.key} className={`ls-${s.state}`}>
                <td className="ls-mark">
                  {s.state === 'done' ? '✓' : s.state === 'failed' ? '×' : s.state === 'active' ? '·' : ''}
                </td>
                <td className="ls-label">{s.label}</td>
                <td className="ls-detail">{s.note ?? s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {error ? (
          <div className="loadscreen-error">
            Load failed: {error}
            <br />
            <a className="inline" href="#/map">
              Return to the red zone map
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
