import { useEffect, useRef, useState } from 'react';
import type { ExplainScope } from '../data/schema';
import { SCOPE_HINTS, SCOPE_LABEL } from '../data/explanations';
import { ask, type FactBundle, type Turn } from '../lib/explain';
import { backendLabel } from '../lib/explain-model';

/**
 * Docked to the panel it belongs to, scoped to what that panel displays.
 *
 * A TRANSCRIPT, NOT A CHAT
 * ------------------------
 * It keeps a thread and it grows when you engage with it, but it deliberately
 * has none of the furniture of a chat client: no avatars, no bubbles, no
 * left/right alternation, no typing indicator. It reads as a ledger of what
 * was asked and what the figures said -- closer to a terminal session or a
 * hearing record.
 *
 * That is a substantive choice, not a stylistic one. Chat furniture advertises
 * open-ended capability and conversational memory, which invites exactly the
 * questions this surface cannot ground, and makes a confabulated answer look
 * native to the interface. Every turn carries the figures it drew on so the
 * officer can check it against the tables above rather than trust it.
 *
 * ENGAGEMENT, NOT MODES
 * ---------------------
 * Three states: closed, open (an input), and engaged (a transcript above the
 * input). Engaged is entered by asking something and left by clearing. The
 * dock grows upward from its anchored bottom edge and overlays rather than
 * reflowing, because pushing the factor table off screen would remove the very
 * evidence the answer is citing.
 */
export function ExplainDock({
  scope,
  bundle,
  defaultOpen = false,
}: {
  scope: ExplainScope;
  /** What the panel is displaying right now. Answers may use nothing else. */
  bundle?: FactBundle;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(1);
  const abort = useRef<AbortController | null>(null);
  const tail = useRef<HTMLDivElement | null>(null);

  const engaged = turns.length > 0;

  /* Keep the newest turn in view as the transcript grows. */
  useEffect(() => {
    if (engaged) tail.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, engaged]);

  useEffect(() => () => abort.current?.abort(), []);

  const submit = async (text: string) => {
    const question = text.trim();
    if (!question || !bundle) return;

    const id = nextId.current++;
    setTurns((t) => [...t, { id, question, state: 'pending', text: '', sources: [] }]);
    setQ('');

    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;

    try {
      const res = await ask(bundle, question, ctrl.signal);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, ...res } : x)));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      setTurns((t) =>
        t.map((x) =>
          x.id === id
            ? {
                ...x,
                state: 'failed',
                text: 'Could not reach the explanation service. The figures on this panel are unaffected — read them directly.',
                sources: [],
              }
            : x,
        ),
      );
    }
  };

  const hints = SCOPE_HINTS[scope];

  return (
    <div className={`explain${open ? ' open' : ''}${engaged ? ' engaged' : ''}`}>
      <button
        className="explain-head disclose"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="caret" aria-hidden />
        <span>Explain</span>
        {engaged ? <span className="explain-count">{turns.length}</span> : null}
        <span className="explain-scope">{SCOPE_LABEL[scope]}</span>
      </button>

      <div className="collapse">
        {engaged ? (
          <div className="transcript">
            {turns.map((t) => (
              <article className={`turn ${t.state}`} key={t.id}>
                <div className="turn-q">
                  <span className="turn-mark" aria-hidden>
                    &gt;
                  </span>
                  {t.question}
                </div>

                {t.state === 'pending' ? (
                  <div className="turn-pending" role="status">
                    <span className="turn-bar" aria-hidden />
                    Reading the figures on this panel
                  </div>
                ) : (
                  <>
                    <div className="turn-a">{t.text}</div>

                    {/* An answer that named a figure the panel does not carry is
                        withheld rather than shown with a caveat. The whole point
                        of the check is that such an answer never reaches the
                        officer as a number they might repeat. */}
                    {t.state === 'ungrounded' ? (
                      <div className="turn-flag">
                        Withheld — the reply referenced{' '}
                        <span className="mono">{t.offending?.join(', ')}</span>, which this
                        panel does not display. Read the tables directly.
                      </div>
                    ) : null}

                    {t.state === 'failed' ? <div className="turn-flag">Not answered</div> : null}

                    {t.sources.length > 0 ? (
                      <div className="turn-src">
                        <b>Drawn from</b>
                        {t.sources.join(' · ')}
                      </div>
                    ) : null}
                  </>
                )}
              </article>
            ))}
            <div ref={tail} />
          </div>
        ) : null}

        <form
          className="explain-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={engaged ? 'Ask a follow-up' : 'Ask about the figures on this panel'}
            aria-label={`Explain, ${SCOPE_LABEL[scope]}`}
            data-explain-input={scope}
            disabled={!bundle}
          />
          <button type="submit" disabled={!bundle || !q.trim()}>
            Ask
          </button>
        </form>

        {hints.length > 0 && !engaged ? (
          <div className="explain-hints">
            {hints.map((h, i) => (
              <span key={h}>
                {i > 0 ? '  ·  ' : ''}
                <button type="button" onClick={() => submit(h)}>
                  {h}
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Always shown once the dock is open, not only after a question: the
            backend is the first thing you want to know when checking whether a
            key took, and it was previously invisible until you had already
            asked something. */}
        <div className="explain-foot">
          <span>
            {engaged
              ? 'Answers narrate only figures displayed in this scope. Numbers are checked back against the panel.'
              : 'Answers narrate only figures displayed in this scope.'}
          </span>
          <span className={`backend ${backendLabel() === 'offline' ? 'off' : 'on'}`}>
            {backendLabel()}
          </span>
          {engaged ? (
            <button type="button" onClick={() => setTurns([])}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
