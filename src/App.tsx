import { useEffect, useState } from 'react';
import { MapView } from './routes/MapView';
import { EvacView } from './routes/EvacView';

/** Must match --t-veil in tokens.css: half a cross-fade. */
const VEIL_MS = 240;

/** Minimal hash routing. Two screens: the national picture, and the
 *  habitation-level evacuation workspace. Deep-linkable so an officer can send
 *  a colleague straight to the habitation under discussion. */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();

  /* Route changes cross-fade through a veil rather than cutting.
   *
   * Leaving the evacuation workspace was the worst of it: that screen is a
   * full-bleed map at district scale and the national map is a different
   * projection of a different extent, so a hard swap read as a glitch. The
   * route is held on the OLD value until the veil is opaque, so the swap
   * itself is never visible. */
  const [shown, setShown] = useState(hash);
  const [veiled, setVeiled] = useState(false);

  useEffect(() => {
    if (hash === shown) return;
    setVeiled(true);
    const t = setTimeout(() => {
      setShown(hash);
      /* Next frame, so the incoming screen has mounted under the veil before
       * it starts lifting. */
      requestAnimationFrame(() => setVeiled(false));
    }, VEIL_MS);
    return () => clearTimeout(t);
  }, [hash, shown]);

  const evac = shown.match(/^#\/evac\/(.+)$/);

  return (
    <>
      <div className="app">
        {evac ? <EvacView habitationId={decodeURIComponent(evac[1])} /> : <MapView />}
      </div>
      <div className={`routeveil${veiled ? ' on' : ''}`} aria-hidden />
      <div className="too-narrow">
        <div>
          <div style={{ letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-2)', fontSize: 11 }}>
            Display too narrow
          </div>
          <div style={{ marginTop: 8, color: 'var(--fg-1)' }}>
            This console requires a minimum width of 1024 px and is designed for 1440 px and above.
          </div>
        </div>
      </div>
    </>
  );
}
