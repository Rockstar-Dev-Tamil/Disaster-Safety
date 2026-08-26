import { MapView } from './routes/MapView';

export default function App() {
  return (
    <>
      <div className="app">
        <MapView />
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
