import { useState } from 'react';
import type { ExplainScope } from '../data/schema';
import { SCOPE_HINTS, SCOPE_LABEL, explain } from '../data/explanations';

type Answer = { text: string; sources: string[]; miss?: true };

/**
 * Docked to the panel it belongs to, scoped to what that panel displays.
 *
 * Deliberately not a chat surface: no avatar, no bubbles, no typing indicator,
 * no thread. One question, one answer, replaced on the next question. The
 * sources line names the displayed factors the answer drew on, so the officer
 * can check it against the tables above rather than trusting it.
 */
export function ExplainDock({
  scope,
  defaultOpen = false,
}: {
  scope: ExplainScope;
  defaultOpen?: boolean;
}) {
  /* Folded by default. The dock is a way in when a figure on the panel is
   * unclear -- it is not itself a finding, and an open input box on every
   * panel reads as the subject rather than the aid. */
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const submit = (text: string) => {
    const query = text.trim();
    if (!query) return;
    setAsked(query);
    setAnswer(explain(scope, query) as Answer);
    setQ('');
  };

  const hints = SCOPE_HINTS[scope];

  return (
    <div className={`explain${open ? ' open' : ''}`}>
      <button className="explain-head disclose" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="caret" aria-hidden />
        <span>Explain</span>
        <span className="explain-scope">{SCOPE_LABEL[scope]}</span>
      </button>

      <div className="collapse">
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
          placeholder="Ask about the figures on this panel"
          aria-label={`Explain, ${SCOPE_LABEL[scope]}`}
          data-explain-input={scope}
        />
        <button type="submit">Ask</button>
      </form>

      {hints.length > 0 && !answer ? (
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

      {answer ? (
        <div className="explain-answer">
          <span className="q">{asked}</span>
          <div className={answer.miss ? 'miss' : undefined}>{answer.text}</div>
          {answer.sources.length > 0 ? (
            <div className="explain-sources">
              <b>Drawn from</b>
              <br />
              {answer.sources.join(' · ')}
            </div>
          ) : null}
        </div>
      ) : null}
      </div>
    </div>
  );
}
