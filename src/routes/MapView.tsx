import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import type { Habitation, HazardType, TierKey } from '../data/schema';

/** Must match --t-camera in tokens.css. */
const CAMERA_MS = 800;
import { HAZARD_LABEL } from '../data/schema';
import { HABITATIONS, HABITATION_BY_ID, OPERATING_CLOCK, STATES } from '../data/habitations';
import { OVERLAYS } from '../data/layers';
import { MapCanvas, type Basemap, type ScoreField } from '../components/MapCanvas';
import { SideRail, type Filters } from '../components/SideRail';
import { HabitationPanel } from '../components/HabitationPanel';
import { ExplainDock } from '../components/ExplainDock';
import type { Fact, FactBundle } from '../lib/explain';
import { OverlayBox } from '../components/primitives';
import { KeyboardSheet, StatusStrip, TopBar } from '../components/Chrome';
import {
  ForecastTimeline,
  type BlendState,
  type SequenceMeta,
} from '../components/ForecastTimeline';
import { BAND_FILL, BAND_LABEL, BAND_RANGE, BAND_ORDER } from '../lib/severity';
import { int } from '../lib/format';

const ALL_HAZARDS: HazardType[] = ['LANDSLIDE', 'FLOOD', 'CYCLONE', 'COASTAL_EROSION', 'CLOUDBURST'];

function lodLabel(z: number) {
  if (z < 5.5) return 'National — top bands only';
  if (z < 7.5) return 'State — moderate and above';
  if (z < 8.6) return 'District — all habitations';
  return 'Habitation — labelled';
}

export function MapView() {
  const [filters, setFilters] = useState<Filters>({
    hazards: new Set(ALL_HAZARDS),
    states: '',
    threshold: 0,
    scoreField: 'current' as ScoreField,
    tiers: new Set<TierKey>(),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTier, setActiveTier] = useState<TierKey>('IMMEDIATE');
  const [overlayId, setOverlayId] = useState<string | null>('district-susceptibility');
  const [basemap, setBasemap] = useState<Basemap>('dim');
  const [sequence, setSequence] = useState<SequenceMeta | null>(null);
  const [blend, setBlend] = useState<BlendState | null>(null);
  const [zoom, setZoom] = useState(4);
  const [showKeys, setShowKeys] = useState(false);
  /** Filter dock slid off to the left. The map is the subject; the controls
   *  that set it should be dismissable once they are set. */
  const [railOut, setRailOut] = useState(false);

  /* MapLibre sizes itself from its container, so a dock that slides over
   * ~220 ms needs the canvas re-measured across those frames -- otherwise the
   * map snaps to its new width only once the transition settles. */
  const nudgeMap = () => {
    const until = performance.now() + 300;
    const tick = () => {
      window.dispatchEvent(new Event('resize'));
      if (performance.now() < until) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const [cursor, setCursor] = useState(0);

  const mapRef = useRef<MLMap | null>(null);

  const filtered = useMemo(() => {
    return HABITATIONS.filter((h) => {
      if (!h.hazards.some((x) => filters.hazards.has(x))) return false;
      if (filters.states && h.state !== filters.states) return false;
      const score = filters.scoreField === 'current' ? h.current.score : h.susceptibility.score;
      if (score < filters.threshold) return false;
      if (filters.tiers.size > 0) {
        const anyTier = [...filters.tiers].some((t) => h.tiers[t] === 'FLAGGED');
        if (!anyTier) return false;
      }
      return true;
    }).sort((a, b) => {
      const sa = filters.scoreField === 'current' ? a.current.score : a.susceptibility.score;
      const sb = filters.scoreField === 'current' ? b.current.score : b.susceptibility.score;
      return sb - sa;
    });
  }, [filters]);

  const selected = selectedId ? HABITATION_BY_ID.get(selectedId) ?? null : null;


  /* Two pieces of state, because a dock has to exist at its closed position
   * before it can travel from there.
   *
   *   lingering -- what the panel DRAWS. Held past close so the dock still has
   *                content while it slides out, instead of vanishing.
   *   panelIn   -- whether the dock is OUT. Set a frame after mount so the
   *                browser paints the closed position first; flipping it in
   *                the same frame as the mount gave an instant open and a
   *                slid close, which is the asymmetry that showed up. */
  const [lingering, setLingering] = useState<Habitation | null>(null);
  const [panelIn, setPanelIn] = useState(false);

  /* Mount the content. */
  useEffect(() => {
    nudgeMap();
    if (selected) {
      setLingering(selected);
      return;
    }
    setPanelIn(false);
    const t = setTimeout(() => setLingering(null), 480);
    return () => clearTimeout(t);
  }, [selected]);

  /* Then, in a LATER effect keyed on the mounted content, flush the closed
   * position and open.
   *
   * Keying this on `selected` instead put the mount and the class change in
   * one frame: the dock appeared already open while closing still slid. This
   * effect only runs once `lingering` has been committed, so the panel is in
   * the DOM and `with-panel` is not yet on the parent -- reading offsetWidth
   * there computes the closed margin and gives the transition a start value. */
  useEffect(() => {
    if (!lingering || !selected) return;
    const el = document.querySelector<HTMLElement>('.mapview > .panel');
    if (!el) return;
    void el.offsetWidth;
    const raf = requestAnimationFrame(() => setPanelIn(true));
    return () => cancelAnimationFrame(raf);
  }, [lingering, selected]);
  const overlay = OVERLAYS.find((o) => o.id === overlayId) ?? null;
  /* What the national view is displaying: the filter state and the counts it
   * produces. Not the underlying habitation set -- an answer may only cite
   * what is on screen. */
  const nationalBundle: FactBundle = useMemo(() => {
    const flagged = (t: TierKey) =>
      HABITATIONS.filter((x) => x.tiers[t] === 'FLAGGED').length;
    const facts: Fact[] = [
      { key: 'clock', label: 'Operating picture timestamp', value: OPERATING_CLOCK, aka: ['time', 'when', 'tonight'] },
      { key: 'plotted', label: 'Habitations in view', value: `${int(filtered.length)} of ${int(HABITATIONS.length)}`, aka: ['plotted', 'shown', 'many'] },
      { key: 'basis', label: 'Score basis', value: filters.scoreField === 'current' ? 'current operational state' : 'standing susceptibility', aka: ['score', 'basis'] },
      { key: 'threshold', label: 'Risk threshold', value: `at or above ${filters.threshold}`, aka: ['filter', 'cutoff'] },
      { key: 'hazards', label: 'Hazard types enabled', value: `${filters.hazards.size} of 5` },
      /* The rail lists a count per hazard type, so those counts are on screen
       * and citable. Without them "where are the cloudburst habitations"
       * missed against a panel that is visibly displaying the answer. */
      ...(['LANDSLIDE', 'FLOOD', 'CYCLONE', 'COASTAL_EROSION', 'CLOUDBURST'] as HazardType[]).map(
        (hz): Fact => ({
          key: `hz-${hz}`,
          label: `Habitations carrying ${HAZARD_LABEL[hz].toLowerCase()} hazard`,
          value: int(HABITATIONS.filter((x) => x.hazards.includes(hz)).length),
          aka: [HAZARD_LABEL[hz], hz.replace('_', ' ')],
        }),
      ),
      { key: 'state', label: 'State filter', value: filters.states || 'all states' },
      { key: 'overlay', label: 'Active overlay', value: overlay?.label ?? 'none', aka: ['layer', 'map'] },
      { key: 'immediate', label: 'Immediate tier flagged', value: int(flagged('IMMEDIATE')), aka: ['tier', 'count'] },
      { key: 'short', label: 'Short-term tier flagged', value: int(flagged('SHORT_TERM')), aka: ['tier', 'count'] },
      { key: 'long', label: 'Long-term tier flagged', value: int(flagged('LONG_TERM')), aka: ['tier', 'count'] },
      { key: 'withheld', label: 'Long-term withheld', value: int(HABITATIONS.filter((x) => x.tiers.LONG_TERM === 'WITHHELD').length), aka: ['withheld'] },
    ];
    return { scope: 'PAN_INDIA' as const, subject: 'the national view under the current filters', facts };
  }, [filtered, filters, overlay]);
  const isSequence = overlay?.kind === 'IMAGE_SEQUENCE';

  /* Sequence manifest is fetched lazily -- only when that overlay is chosen. */
  useEffect(() => {
    if (!isSequence || !overlay?.url) {
      setSequence(null);
      setBlend(null);
      return;
    }
    let cancelled = false;
    fetch(overlay.url)
      .then((r) => r.json())
      .then((m: SequenceMeta) => {
        if (!cancelled) setSequence(m);
      })
      .catch(() => {
        if (!cancelled) setSequence(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isSequence, overlay?.url]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      const h = HABITATION_BY_ID.get(id);
      const map = mapRef.current;
      if (h && map) {
        /* Eased, not cut. Jumping between habitations relocates the viewport
         * across the country; a hard cut loses the reader's place, whereas a
         * pan carries the spatial relationship between the two. */
        map.easeTo({
          center: h.lngLat,
          zoom: Math.max(map.getZoom(), 9.4),
          duration: CAMERA_MS,
          essential: true,
        });
      }
    },
    [],
  );

  /* --------------------------------------------------------- keyboard --- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

      if (e.key === 'Escape') {
        if (showKeys) setShowKeys(false);
        else if (typing) (el as HTMLElement).blur();
        else setSelectedId(null);
        return;
      }
      if (typing) return;

      if (e.key === '?') {
        setShowKeys((s) => !s);
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLSelectElement>('.rail select')?.focus();
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const inputs = document.querySelectorAll<HTMLInputElement>('[data-explain-input]');
        inputs[inputs.length - 1]?.focus();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        setFilters((f) => ({
          ...f,
          scoreField: f.scoreField === 'current' ? 'susceptibility' : 'current',
        }));
        return;
      }
      if (e.key === 'b' || e.key === 'B') {
        setBasemap((b) => (b === 'off' ? 'dim' : b === 'dim' ? 'terrain' : 'off'));
        return;
      }
      if (e.key === '1') setActiveTier('IMMEDIATE');
      if (e.key === '2') setActiveTier('SHORT_TERM');
      if (e.key === '3') setActiveTier('LONG_TERM');

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => {
          const next = Math.max(0, Math.min(filtered.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1)));
          document.querySelector(`[data-hit="${filtered[next]?.id}"]`)?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      }
      if (e.key === 'Enter' && filtered[cursor]) select(filtered[cursor].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, cursor, showKeys, select]);

  return (
    <>
      <TopBar onShowKeys={() => setShowKeys(true)} />

      <div className={`mapview${panelIn ? ' with-panel' : ''}${railOut ? ' rail-out' : ''}`}>
        <SideRail
          filters={filters}
          setFilters={setFilters}
          results={filtered}
          all={HABITATIONS}
          states={STATES}
          selectedId={selectedId}
          onSelect={select}
          overlayId={overlayId}
          setOverlayId={setOverlayId}
          basemap={basemap}
          setBasemap={setBasemap}
        />

        <div className="mapstage">
          {/* The handle stays put when the rail slides off, so a hidden dock is
              never unreachable. */}
          <button
            className="dockhandle left"
            onClick={() => { setRailOut((v) => !v); nudgeMap(); }}
            title={railOut ? 'Show filters' : 'Hide filters'}
            aria-expanded={!railOut}
          >
            {railOut ? '›' : '‹'}
          </button>
          <MapCanvas
            habitations={filtered}
            selectedId={selectedId}
            onSelect={select}
            scoreField={filters.scoreField}
            overlayId={overlayId}
            overlayField={overlay?.derivedField ?? null}
            overlayOpacity={overlay?.opacity ?? 0.4}
            vectorOverlay={
              overlay && overlay.kind === 'GEOJSON' && overlay.url && overlay.classField
                ? {
                    id: overlay.id,
                    url: overlay.url,
                    classField: overlay.classField,
                    classColors: overlay.classColors ?? {},
                  }
                : null
            }
            imageOverlay={
              overlay && overlay.kind === 'IMAGE' && overlay.url && overlay.imageBounds
                ? {
                    id: overlay.id,
                    url: overlay.url,
                    bounds: overlay.imageBounds,
                    opacity: overlay.opacity,
                  }
                : null
            }
            sequenceOverlay={
              isSequence && blend && overlay?.imageBounds
                ? {
                    a: blend.a.file,
                    b: blend.b.file,
                    f: blend.f,
                    bounds: overlay.imageBounds,
                    opacity: overlay.opacity,
                  }
                : null
            }
            basemap={basemap}
            onMapReady={(m) => {
              mapRef.current = m;
            }}
            onZoomChange={setZoom}
          />

          <div className="map-overlay map-scale">
            <div className="zoomctx">
              <div className="zoomctx-row">
                <span className="lod">{lodLabel(zoom)}</span>
                <span className="mono">z{zoom.toFixed(1)}</span>
              </div>
              <div className="zoomctx-row">
                <span>Plotted</span>
                <span className="mono">{int(filtered.length)}</span>
              </div>
              <div className="zoomctx-row">
                <span>Basis</span>
                <span className="mono">
                  {filters.scoreField === 'current' ? 'current' : 'susceptibility'}
                </span>
              </div>
            </div>
          </div>

          {overlay ? (
            <div className="map-overlay map-legend">
              <OverlayBox title={overlay.label}>
                <div>
              {overlay.legend.map((l) => (
                <div className="legend-row" key={l.label}>
                  <span
                    style={{
                      width: 14,
                      height: 8,
                      background: l.color ?? (l.band ? BAND_FILL[l.band] : 'transparent'),
                      display: 'block',
                      opacity: 0.85,
                    }}
                  />
                  <span className="lbl">{l.label}</span>
                  <span className="rng">{l.note ?? (l.band ? BAND_RANGE[l.band] : '')}</span>
                </div>
              ))}
              {overlay.bounds ? (
                <button
                  className="railbtn"
                  style={{ marginTop: 'var(--s-3)' }}
                  onClick={() =>
                    mapRef.current?.fitBounds(overlay.bounds!, {
                      padding: 30,
                      duration: CAMERA_MS,
                      essential: true,
                    })
                  }
                >
                  Zoom to layer extent
                </button>
              ) : null}
              <div className="legend-note">{overlay.meaning}</div>
                </div>
              </OverlayBox>
            </div>
          ) : (
            <div className="map-overlay map-legend">
              <OverlayBox title="Habitation severity">
                <div>
                  {[...BAND_ORDER].reverse().map((b) => (
                    <div className="legend-row" key={b}>
                      <span style={{ width: 10, height: 10, background: BAND_FILL[b], display: 'block' }} />
                      <span className="lbl">{BAND_LABEL[b]}</span>
                      <span className="rng">{BAND_RANGE[b]}</span>
                    </div>
                  ))}
                </div>
              </OverlayBox>
            </div>
          )}

          {sequence ? (
            <div className="map-overlay map-timeline">
              <ForecastTimeline meta={sequence} onBlend={setBlend} />
            </div>
          ) : null}

          {/* National-level explanation input, docked to the map stage. */}
          <div className="map-overlay map-explain">
            <ExplainDock scope="PAN_INDIA" bundle={nationalBundle} />
          </div>
        </div>

        {/* Rendered from `lingering`, not `selected`, so the dock still has
            content to draw while it slides out. Unmounting on close would make
            the panel vanish rather than leave. */}
        {lingering ? (
          <HabitationPanel
            key={lingering.id}
            h={lingering}
            onClose={() => setSelectedId(null)}
            activeTier={activeTier}
            setActiveTier={setActiveTier}
          />
        ) : null}
      </div>

      <StatusStrip clock={OPERATING_CLOCK} all={HABITATIONS} filtered={filtered} />

      {showKeys ? <KeyboardSheet onClose={() => setShowKeys(false)} /> : null}
    </>
  );
}
