import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import type { HazardType, TierKey } from '../data/schema';
import { HABITATIONS, HABITATION_BY_ID, OPERATING_CLOCK, STATES } from '../data/habitations';
import { OVERLAYS } from '../data/layers';
import { MapCanvas, type Basemap, type ScoreField } from '../components/MapCanvas';
import { SideRail, type Filters } from '../components/SideRail';
import { HabitationPanel } from '../components/HabitationPanel';
import { ExplainDock } from '../components/ExplainDock';
import { KeyboardSheet, StatusStrip, TopBar } from '../components/Chrome';
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
  const [zoom, setZoom] = useState(4);
  const [showKeys, setShowKeys] = useState(false);
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
  const overlay = OVERLAYS.find((o) => o.id === overlayId) ?? null;

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      const h = HABITATION_BY_ID.get(id);
      const map = mapRef.current;
      if (h && map) {
        map.easeTo({
          center: h.lngLat,
          zoom: Math.max(map.getZoom(), 9.4),
          duration: 0, // instant panel switches, no easing flourish
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

      <div className={`mapview${selected ? ' with-panel' : ''}`}>
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
              <div className="legend-title">{overlay.label}</div>
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
                  onClick={() => mapRef.current?.fitBounds(overlay.bounds!, { padding: 30, duration: 0 })}
                >
                  Zoom to layer extent
                </button>
              ) : null}
              <div className="legend-note">{overlay.meaning}</div>
            </div>
          ) : (
            <div className="map-overlay map-legend">
              <div className="legend-title">Habitation severity</div>
              {[...BAND_ORDER].reverse().map((b) => (
                <div className="legend-row" key={b}>
                  <span style={{ width: 10, height: 10, background: BAND_FILL[b], display: 'block' }} />
                  <span className="lbl">{BAND_LABEL[b]}</span>
                  <span className="rng">{BAND_RANGE[b]}</span>
                </div>
              ))}
            </div>
          )}

          {/* National-level explanation input, docked to the map stage. */}
          <div className="map-overlay map-explain">
            <ExplainDock scope="PAN_INDIA" />
          </div>
        </div>

        {selected ? (
          <HabitationPanel
            key={selected.id}
            h={selected}
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
