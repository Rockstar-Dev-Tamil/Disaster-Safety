import { useEffect, useState } from 'react';
import { MapView } from './routes/MapView';
import { EvacView } from './routes/EvacView';

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
  const evac = hash.match(/^#\/evac\/(.+)$/);

  return (
    <>
      <div className="app">
        {evac ? <EvacView habitationId={decodeURIComponent(evac[1])} /> : <MapView />}
      </div>
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
