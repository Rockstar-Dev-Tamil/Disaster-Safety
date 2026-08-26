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
  analyse,
  ellipseFeature,
  mergeKmForZoom,
  mergeZones,
  shortlist as shortlistFn,
  type Rules,
  type Weights,
  type ZoneResult,
} from '../lib/zones';
import { ZonePanel } from '../components/ZonePanel';
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

  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [selected, setSelected] = useState<number | null>(null);
  const [shortlistSize, setShortlistSize] = useState(10);
  const [zoom, setZoom] = useState(10.4);
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

  /* Level of detail: zoomed out, nearby clusters combine into general areas;
   * zoomed in they separate so an evaluator can judge each patch. */
  const mergeKm = mergeKmForZoom(zoom);
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

  const routeResult: RouteResult | null = useMemo(() => {
    if (!stack || !adjacency || !edgeRisks || !selectedZone || !h) return null;
    const from = nearestNode(stack.graph, h.lngLat);
    const to = nearestNode(stack.graph, selectedZone.centroid);
    if (from === to) return null;
    return computeRoutes(stack.graph, adjacency, edgeRisks, blocked, routeParams, from, to);
  }, [stack, adjacency, edgeRisks, selectedZone, blocked, routeParams, h]);

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
        ],
      },
      center: h.lngLat,
      zoom: 10.4,
      maxZoom: 16,
      minZoom: 8,
      attributionControl: { compact: true },
      dragRotate: false,
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
          'line-opacity': ['case', ['get', 'primary'], 1, 0.5],
          'line-dasharray': ['case', ['get', 'blocked'], ['literal', [1.5, 1.5]], ['literal', [1, 0]]],
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
            ['get', 'selected'], '#8fc6ea',
            ['get', 'shortlisted'], '#a8d98a',
            '#6e8a5e',
          ],
          'line-width': [
            'case',
            ['get', 'selected'], 2.2,
            ['get', 'shortlisted'], 1.3,
            0.7,
          ],
          'line-dasharray': [2, 2],
        },
      });
      map.addSource('zone-pts', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'zone-dot',
        type: 'circle',
        source: 'zone-pts',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 5, ['get', 'shortlisted'], 3.4, 1.8],
          'circle-color': [
            'case',
            ['get', 'selected'], '#8fc6ea',
            ['get', 'shortlisted'], '#a8d98a',
            '#6e8a5e',
          ],
          'circle-stroke-color': '#05070a',
          'circle-stroke-width': 1.2,
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
    const { crop, reason, score } = result;
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
    map.setPaintProperty('eligible-layer', 'raster-opacity', 0.85);

    /* Every cluster above the size floor gets an ellipse. The shortlist is a
     * ranking, not a filter on what exists -- an officer scanning the map has
     * to see the large uncircled patch rather than wonder why it is missing. */
    const short = new Set(
      shortlistFn(areas, shortlistSize, rules.minSeparationKm).map((p) => p.zone.id),
    );
    const shown = areas;
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
        properties: { id: z.id, selected: isSel(z), shortlisted: short.has(z.id) },
        geometry: { type: 'Point' as const, coordinates: z.centroid },
      })),
    });
  }, [result, areas, selected, mapReady, shortlistSize, rules.minSeparationKm]);

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
    map.fitBounds([w, so, e, no], { padding: 90, duration: 0, maxZoom: 13 });
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
              </div>
            </div>

            <div className="map-overlay map-legend">
              <div className="legend-title">Constraint layers</div>
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
              {selectedZone ? (
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
                KSDMA sheets at 1:50,000 — boundaries are good to roughly 50–100 m, so do not read
                them as parcel-accurate at this zoom.
              </div>
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
              <div className="panel-figs">
                <div className="fig">
                  <div className="fig-label">Population</div>
                  <div className="fig-val">{int(h.population)}</div>
                </div>
                <div className="fig">
                  <div className="fig-label">Households</div>
                  <div className="fig-val">{int(h.households)}</div>
                </div>
                <div className="fig">
                  <div className="fig-label">Susceptibility</div>
                  <div className="fig-val" style={{ color: BAND_TEXT[h.susceptibility.band] }}>
                    {h.susceptibility.score.toFixed(1)}
                  </div>
                </div>
                <div className="fig">
                  <div className="fig-label">Current</div>
                  <div className="fig-val">{h.current.score.toFixed(1)}</div>
                </div>
              </div>
            </div>

            <div className="panel-body">
              <section className="block">
                <div className="block-head">
                  <span>Search area</span>
                  <span className="aux">{RADIUS_KM} km radius</span>
                </div>
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
              </section>

              {pub ? (
                <section className="block">
                  <div className="block-head">
                    <span>Published class at origin</span>
                  </div>
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
                </section>
              ) : null}

              {result ? (
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

              {selectedZone ? (
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
        <div className="loadscreen-head">
          <span>Preparing evacuation planning</span>
          <span className="mono">
            {done} / {stages.length}
          </span>
        </div>
        <div className="loadscreen-sub">
          {h.name} · {h.block} block · {h.district} · {RADIUS_KM} km operation radius
        </div>

        <div className="loadbar">
          <i style={{ width: `${(done / stages.length) * 100}%` }} />
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
