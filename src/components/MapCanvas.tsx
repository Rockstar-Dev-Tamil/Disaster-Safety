import { useEffect, useRef, useState } from 'react';
import maplibregl, { type ExpressionSpecification, type Map as MLMap } from 'maplibre-gl';
import type { Habitation } from '../data/schema';
import { BAND_FILL, BAND_RADIUS, BAND_STROKE, alertToBand, bandFor } from '../lib/severity';

export type ScoreField = 'current' | 'susceptibility';

/** Terrain legibility varies enormously between a laptop panel and a venue
 *  projector, so the base is operator-controlled rather than fixed. */
export type Basemap = 'off' | 'dim' | 'terrain';

const BASE_PAINT: Record<Basemap, { opacity: number; brightnessMax: number; contrast: number }> = {
  off:     { opacity: 0,    brightnessMax: 0.4,  contrast: 0 },
  dim:     { opacity: 0.34, brightnessMax: 0.38, contrast: 0.35 },
  terrain: { opacity: 0.62, brightnessMax: 0.52, contrast: 0.45 },
};

export interface MapCanvasProps {
  habitations: Habitation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  scoreField: ScoreField;
  /** Active derived overlay id, or null. */
  overlayId: string | null;
  overlayField: 'susceptibility' | 'alert' | null;
  overlayOpacity: number;
  /** GEOJSON overlay. Either categorical (classField + classColors, drawn as
   *  filled polygons) or continuous (rampField + ramp, drawn as points). A
   *  measured rate is a number on a scale, not a class, and forcing it into
   *  bands would throw away the distinction between -6 and -14 m/yr. */
  vectorOverlay: {
    id: string;
    url: string;
    classField?: string;
    classColors?: Record<string, string>;
    rampField?: string;
    /** [value, colour] stops, ascending by value. */
    ramp?: Array<[number, string]>;
    circleRadius?: number;
  } | null;
  /** Georeferenced PNG overlay (forecast fields), or null.
   *
   *  Suitable only for SMALL images. A single MapLibre image source was
   *  measured rendering as an opaque black rectangle at 256 px and above in
   *  this build's test environment, while rendering correctly at 119x127.
   *  Anything larger belongs in `tileOverlay`. */
  imageOverlay: { id: string; url: string; bounds: [number, number, number, number]; opacity: number } | null;
  /** XYZ raster pyramid, for rasters too large to drape as one image. */
  tileOverlay: {
    id: string;
    /** Tile template, e.g. /flood-assam/{z}/{x}/{y}.png */
    url: string;
    bounds: [number, number, number, number];
    opacity: number;
    maxzoom: number;
  } | null;
  /** Animated forecast: two frames cross-faded by `f` so the field morphs
   *  continuously rather than snapping every 3 h. */
  sequenceOverlay: {
    a: string;
    b: string;
    f: number;
    bounds: [number, number, number, number];
    opacity: number;
  } | null;
  basemap: Basemap;
  onMapReady: (map: MLMap) => void;
  onZoomChange: (z: number) => void;
}

/* Hillshade only: no administrative boundaries are baked into these tiles, so
 * the only boundaries drawn are the ones this application controls. That is
 * deliberate -- a consumer basemap would render the international depiction of
 * J&K, Ladakh and Arunachal, which is not usable on a Ministry display. */
const BASE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';

const INDIA_BOUNDS: [number, number, number, number] = [67.5, 6.0, 98.0, 37.6];

const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function MapCanvas(props: MapCanvasProps) {
  const {
    habitations,
    selectedId,
    onSelect,
    scoreField,
    overlayField,
    overlayOpacity,
    vectorOverlay,
    imageOverlay,
    tileOverlay,
    sequenceOverlay,
    basemap,
    onMapReady,
    onZoomChange,
  } = props;

  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [vectorFailed, setVectorFailed] = useState(false);
  const [labels, setLabels] = useState<Array<{ id: string; name: string; x: number; y: number; score: number }>>([]);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  /* ------------------------------------------------------------ init --- */
  useEffect(() => {
    if (!holder.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: holder.current,
      style: {
        version: 8,
        sources: {
          hillshade: {
            type: 'raster',
            tiles: [BASE_TILES],
            tileSize: 256,
            maxzoom: 13,
            attribution: 'Hillshade: Esri. Boundaries: bundled, Government of India depiction.',
          },
        },
        layers: [
          { id: 'ground', type: 'background', paint: { 'background-color': '#05070a' } },
          {
            id: 'hillshade',
            type: 'raster',
            source: 'hillshade',
            /* Esri hillshade is a light-grey image and fills ocean with flat
             * grey, which washes the whole viewport out. brightness-max clamps
             * the white point so the tile lands in a dark range instead of
             * dominating; contrast then puts the relief back. */
            paint: {
              'raster-opacity': 0.34,
              'raster-saturation': -1,
              'raster-contrast': 0.35,
              'raster-brightness-min': 0,
              'raster-brightness-max': 0.38,
            },
          },
        ],
      },
      bounds: INDIA_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxZoom: 14,
      minZoom: 3.2,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 0,
    });

    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    map.on('error', (e) => {
      if (String(e?.error?.message ?? '').includes('tile')) setTilesFailed(true);
    });

    map.on('load', async () => {
      /* Boundaries are bundled locally, so they render with or without a
       * network connection -- venue wifi is not a dependency. */
      const [states, districts] = await Promise.all([
        fetch('/geo/india-states.json').then((r) => r.json()),
        fetch('/geo/india-districts.json').then((r) => r.json()),
      ]);

      map.addSource('states', { type: 'geojson', data: states });
      map.addSource('districts', { type: 'geojson', data: districts });
      map.addSource('habitations', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      /* Lifts land above sea. The hillshade covers ocean with the same flat
       * grey as land, so without this the coastline is invisible. */
      map.addLayer({
        id: 'land',
        type: 'fill',
        source: 'states',
        paint: { 'fill-color': '#28323d', 'fill-opacity': 0.5 },
      });

      map.addLayer({
        id: 'district-fill',
        type: 'fill',
        source: 'districts',
        paint: { 'fill-color': 'transparent', 'fill-opacity': 0 },
      });

      /* Every boundary is drawn twice: a dark casing, then a bright line on
       * top. That is what keeps a hairline readable over both the dark sea and
       * a saturated overlay fill underneath it. */
      map.addLayer({
        id: 'district-line-casing',
        type: 'line',
        source: 'districts',
        minzoom: 5,
        paint: {
          'line-color': '#05070a',
          'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 9, 2.4],
        },
      });
      map.addLayer({
        id: 'district-line',
        type: 'line',
        source: 'districts',
        minzoom: 5,
        paint: {
          'line-color': '#5d6b7a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.9],
        },
      });

      map.addLayer({
        id: 'state-line-casing',
        type: 'line',
        source: 'states',
        paint: {
          'line-color': '#05070a',
          'line-opacity': 0.95,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 8, 3.6],
        },
      });
      map.addLayer({
        id: 'state-line',
        type: 'line',
        source: 'states',
        paint: {
          'line-color': '#93a1b0',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 1.6],
        },
      });

      /* Forecast raster: a georeferenced PNG rather than tiles, because the
       * field is only 127x119 cells and a single 4 KB image beats a tile
       * pyramid at this size. */
      map.addSource('image-overlay', {
        type: 'image',
        url: TRANSPARENT_PX,
        coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]],
      });
      map.addLayer({
        id: 'image-overlay-layer',
        type: 'raster',
        source: 'image-overlay',
        paint: { 'raster-opacity': 0, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
      });

      /* Two sources so consecutive forecast frames can be blended. One source
       * with updateImage would hard-cut on every step. */
      for (const slot of ['seq-a', 'seq-b']) {
        map.addSource(slot, {
          type: 'image',
          url: TRANSPARENT_PX,
          coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]],
        });
        map.addLayer({
          id: `${slot}-layer`,
          type: 'raster',
          source: slot,
          paint: {
            'raster-opacity': 0,
            'raster-resampling': 'nearest',
            'raster-fade-duration': 0,
          },
        });
      }

      /* Vector hazard sheets sit above the district shading but below the
       * habitation points, so a point is never hidden by its own hazard zone. */
      map.addSource('vector-overlay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'vector-overlay-fill',
        type: 'fill',
        source: 'vector-overlay',
        paint: { 'fill-color': '#888888', 'fill-opacity': 0 },
      });
      map.addLayer({
        id: 'vector-overlay-line',
        type: 'line',
        source: 'vector-overlay',
        paint: { 'line-color': '#05070a', 'line-width': 0.4, 'line-opacity': 0 },
      });
      /* Point form of the same source, for continuous measurements. Radius
       * grows with zoom because at 100 m transect spacing the points merge
       * into a line at district zoom and want to separate when you go in. */
      map.addLayer({
        id: 'vector-overlay-circle',
        type: 'circle',
        source: 'vector-overlay',
        paint: {
          'circle-color': '#888888',
          'circle-opacity': 0,
          'circle-stroke-width': 0,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            6, 1.4,
            9, 2.6,
            12, 5,
            15, 9,
          ],
        },
      });

      map.addLayer({
        id: 'habitation-halo',
        type: 'circle',
        source: 'habitations',
        paint: {
          'circle-radius': 0,
          'circle-color': 'transparent',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0,
        },
      });
      map.addLayer({
        id: 'habitation',
        type: 'circle',
        source: 'habitations',
        paint: {
          'circle-color': ['get', 'fill'],
          'circle-opacity': 0.96,
          'circle-stroke-color': '#05070a',
          'circle-stroke-width': ['get', 'sw'],
          'circle-radius': 0,
        },
      });

      map.on('click', 'habitation', (e) => {
        const f = e.features?.[0];
        if (f) selectRef.current(String(f.properties?.id));
      });
      map.on('mouseenter', 'habitation', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'habitation', () => {
        map.getCanvas().style.cursor = '';
      });

      mapRef.current = map;
      setReady(true);
      onMapReady(map);
      onZoomChange(map.getZoom());
    });

    map.on('zoom', () => onZoomChange(map.getZoom()));

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------ habitation points --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('habitations') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    src.setData({
      type: 'FeatureCollection',
      features: habitations.map((h) => {
        const score = scoreField === 'current' ? h.current.score : h.susceptibility.score;
        const band = bandFor(score);
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: h.lngLat },
          properties: {
            id: h.id,
            name: h.name,
            score,
            fill: BAND_FILL[band],
            r: BAND_RADIUS[band],
            sw: BAND_STROKE[band],
          },
        };
      }),
    });
  }, [habitations, scoreField, ready]);

  /* ------------------------------------------------------------- LOD --- */
  /* Point density genuinely increases with zoom: at national zoom only the top
   * bands are drawn, and radius goes to 0 (not just opacity) so hidden points
   * are not click targets either. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const radius: ExpressionSpecification = [
      'step',
      ['zoom'],
      ['case', ['>=', ['get', 'score'], 70], ['*', ['get', 'r'], 0.8], 0],
      5.5,
      ['case', ['>=', ['get', 'score'], 45], ['get', 'r'], 0],
      7.5,
      ['*', ['get', 'r'], 1.3],
    ];
    map.setPaintProperty('habitation', 'circle-radius', radius);
  }, [ready]);

  /* --------------------------------------------------------- basemap --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const p = BASE_PAINT[basemap];
    map.setPaintProperty('hillshade', 'raster-opacity', p.opacity);
    map.setPaintProperty('hillshade', 'raster-brightness-max', p.brightnessMax);
    map.setPaintProperty('hillshade', 'raster-contrast', p.contrast);
    map.setPaintProperty('land', 'fill-opacity', basemap === 'off' ? 0.72 : 0.5);
  }, [basemap, ready]);

  /* ----------------------------------------------------- image overlay --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('image-overlay') as maplibregl.ImageSource | undefined;
    if (!src) return;

    if (!imageOverlay) {
      map.setPaintProperty('image-overlay-layer', 'raster-opacity', 0);
      return;
    }
    const [w, s2, e, n] = imageOverlay.bounds;
    src.updateImage({
      url: imageOverlay.url,
      coordinates: [[w, n], [e, n], [e, s2], [w, s2]],
    });
    map.setPaintProperty('image-overlay-layer', 'raster-opacity', imageOverlay.opacity);
  }, [imageOverlay, ready]);

  /* ------------------------------------------------------ tile overlay --- */
  /* A raster source's tiles and bounds are fixed when it is constructed, so
   * unlike the image overlay this one is torn down and rebuilt when the layer
   * changes. `bounds` matters: without it MapLibre requests tiles across the
   * whole world, every one of which 404s, and this app reports a raster tile
   * error as a basemap failure. */
  const tileId = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const teardown = () => {
      if (map.getLayer('tile-overlay-layer')) map.removeLayer('tile-overlay-layer');
      if (map.getSource('tile-overlay')) map.removeSource('tile-overlay');
      tileId.current = null;
    };

    if (!tileOverlay) {
      teardown();
      return;
    }
    if (tileId.current === tileOverlay.id) {
      map.setPaintProperty('tile-overlay-layer', 'raster-opacity', tileOverlay.opacity);
      return;
    }
    teardown();
    map.addSource('tile-overlay', {
      type: 'raster',
      tiles: [tileOverlay.url],
      tileSize: 256,
      bounds: tileOverlay.bounds,
      maxzoom: tileOverlay.maxzoom,
    });
    map.addLayer(
      {
        id: 'tile-overlay-layer',
        type: 'raster',
        source: 'tile-overlay',
        paint: {
          'raster-opacity': tileOverlay.opacity,
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0,
        },
      },
      /* Same slot the image overlay occupies: above boundaries, below the
       * habitation points, so a point is never hidden by its own hazard. */
      map.getLayer('seq-a-layer') ? 'seq-a-layer' : undefined,
    );
    tileId.current = tileOverlay.id;
  }, [tileOverlay, ready]);

  /* -------------------------------------------------- sequence overlay --- */
  const seqUrls = useRef<{ a: string | null; b: string | null }>({ a: null, b: null });
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (!sequenceOverlay) {
      map.setPaintProperty('seq-a-layer', 'raster-opacity', 0);
      map.setPaintProperty('seq-b-layer', 'raster-opacity', 0);
      seqUrls.current = { a: null, b: null };
      return;
    }

    const [w, s2, e, n] = sequenceOverlay.bounds;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [w, n],
      [e, n],
      [e, s2],
      [w, s2],
    ];
    /* Only re-upload a texture when the frame actually changes; the blend
     * factor updates every animation tick and must stay cheap. */
    if (seqUrls.current.a !== sequenceOverlay.a) {
      (map.getSource('seq-a') as maplibregl.ImageSource).updateImage({
        url: sequenceOverlay.a,
        coordinates: coords,
      });
      seqUrls.current.a = sequenceOverlay.a;
    }
    if (seqUrls.current.b !== sequenceOverlay.b) {
      (map.getSource('seq-b') as maplibregl.ImageSource).updateImage({
        url: sequenceOverlay.b,
        coordinates: coords,
      });
      seqUrls.current.b = sequenceOverlay.b;
    }
    const o = sequenceOverlay.opacity;
    map.setPaintProperty('seq-a-layer', 'raster-opacity', o * (1 - sequenceOverlay.f));
    map.setPaintProperty('seq-b-layer', 'raster-opacity', o * sequenceOverlay.f);
  }, [sequenceOverlay, ready]);

  /* ---------------------------------------------------- vector overlay --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('vector-overlay') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const hideAll = () => {
      map.setPaintProperty('vector-overlay-fill', 'fill-opacity', 0);
      map.setPaintProperty('vector-overlay-line', 'line-opacity', 0);
      map.setPaintProperty('vector-overlay-circle', 'circle-opacity', 0);
    };

    if (!vectorOverlay) {
      hideAll();
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    let cancelled = false;
    fetch(vectorOverlay.url)
      .then((r) => r.json())
      .then((gj) => {
        if (cancelled || !mapRef.current) return;
        src.setData(gj);
        hideAll();

        if (vectorOverlay.rampField && vectorOverlay.ramp?.length) {
          /* Continuous. Stops must ascend or MapLibre rejects the expression,
           * and a rejected paint property leaves the layer at its default
           * grey -- which would read as "measured, and uniform". */
          const stops = [...vectorOverlay.ramp].sort((a, b) => a[0] - b[0]).flat();
          map.setPaintProperty('vector-overlay-circle', 'circle-color', [
            'interpolate',
            ['linear'],
            ['to-number', ['get', vectorOverlay.rampField]],
            ...stops,
          ] as unknown as ExpressionSpecification);
          map.setPaintProperty('vector-overlay-circle', 'circle-opacity', overlayOpacity);
          return;
        }

        const pairs: string[] = [];
        for (const [k, v] of Object.entries(vectorOverlay.classColors ?? {})) pairs.push(k, v);
        map.setPaintProperty('vector-overlay-fill', 'fill-color', [
          'match',
          ['get', vectorOverlay.classField],
          ...(pairs as [string, string]),
          '#6b7280',
        ] as unknown as ExpressionSpecification);
        map.setPaintProperty('vector-overlay-fill', 'fill-opacity', overlayOpacity);
        map.setPaintProperty('vector-overlay-line', 'line-opacity', 0.35);
      })
      .catch(() => {
        if (!cancelled) setVectorFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [vectorOverlay, overlayOpacity, ready]);

  /* --------------------------------------------------- district overlay --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (!overlayField) {
      map.setPaintProperty('district-fill', 'fill-opacity', 0);
      return;
    }

    /* Keyed on name + state because district names repeat across states. */
    const worst = new Map<string, number>();
    for (const h of habitations) {
      const key = `${h.district}|${h.state}`;
      const v =
        overlayField === 'susceptibility'
          ? h.susceptibility.score
          : { GREEN: 25, YELLOW: 50, ORANGE: 70, RED: 90 }[h.current.alert];
      worst.set(key, Math.max(worst.get(key) ?? 0, v));
    }

    const pairs: string[] = [];
    for (const [key, v] of worst) {
      pairs.push(key, BAND_FILL[overlayField === 'alert' ? alertToBand[bandToAlert(v)] : bandFor(v)]);
    }

    if (pairs.length === 0) {
      map.setPaintProperty('district-fill', 'fill-opacity', 0);
      return;
    }

    map.setPaintProperty('district-fill', 'fill-color', [
      'match',
      ['concat', ['get', 'name'], '|', ['get', 'state']],
      ...(pairs as [string, string]),
      'transparent',
    ] as unknown as ExpressionSpecification);

    map.setPaintProperty('district-fill', 'fill-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      3,
      overlayOpacity,
      9,
      overlayOpacity * 0.45,
    ] as unknown as ExpressionSpecification);
  }, [habitations, overlayField, overlayOpacity, ready]);

  /* ---------------------------------------------------------- selection --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!selectedId) {
      map.setPaintProperty('habitation-halo', 'circle-radius', 0);
      map.setPaintProperty('habitation-halo', 'circle-stroke-width', 0);
      return;
    }
    const match: ExpressionSpecification = ['==', ['get', 'id'], selectedId];
    map.setPaintProperty('habitation-halo', 'circle-radius', [
      'case',
      match,
      12,
      0,
    ] as unknown as ExpressionSpecification);
    map.setPaintProperty('habitation-halo', 'circle-stroke-width', [
      'case',
      match,
      1.5,
      0,
    ] as unknown as ExpressionSpecification);
    map.setPaintProperty('habitation-halo', 'circle-stroke-color', '#4d9fd6');
  }, [selectedId, ready]);

  /* ------------------------------------------------------------ labels --- */
  /* Rendered as projected DOM rather than a symbol layer: no glyph server, so
   * labels survive an offline venue. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const z = map.getZoom();
      if (z < 8.6) {
        setLabels((l) => (l.length ? [] : l));
        return;
      }
      const b = map.getBounds();
      const out: Array<{ id: string; name: string; x: number; y: number; score: number }> = [];
      for (const h of habitations) {
        if (out.length >= 45) break;
        const [lng, lat] = h.lngLat;
        if (lng < b.getWest() || lng > b.getEast() || lat < b.getSouth() || lat > b.getNorth()) continue;
        const p = map.project(h.lngLat);
        out.push({
          id: h.id,
          name: h.name,
          x: p.x,
          y: p.y,
          score: scoreField === 'current' ? h.current.score : h.susceptibility.score,
        });
      }
      setLabels(out);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    map.on('move', schedule);
    map.on('moveend', schedule);
    update();

    return () => {
      map.off('move', schedule);
      map.off('moveend', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [habitations, scoreField, ready]);

  return (
    <>
      <div ref={holder} className="mapcanvas" />
      <div className="map-labels">
        {labels.map((l) => (
          <span
            key={l.id}
            className="maplabel"
            style={{ left: l.x + 9, top: l.y - 7 }}
            onClick={() => onSelect(l.id)}
          >
            {l.name} <i>{l.score.toFixed(0)}</i>
          </span>
        ))}
      </div>
      {vectorFailed ? (
        <div className="map-overlay tilewarn" style={{ top: 40 }}>
          Hazard sheet failed to load — check /layers/ is being served.
        </div>
      ) : null}
      {tilesFailed ? (
        <div className="map-overlay tilewarn">
          Terrain tiles unavailable — boundaries and habitation points are bundled locally and remain accurate.
        </div>
      ) : null}
    </>
  );
}

function bandToAlert(v: number): 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' {
  if (v >= 90) return 'RED';
  if (v >= 70) return 'ORANGE';
  if (v >= 50) return 'YELLOW';
  return 'GREEN';
}
