import { useState } from 'react';
import Icon from './Icon.jsx';
import { AskSheet } from './ContextBar.jsx';

/** Ask from anywhere: a small button in a screen's top bar, scoped to `subject` when there is one. */
export function AskButton({ subject = null }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label={subject ? `Ask about ${subject.label}` : 'Ask your journal'} title="Ask"><Icon name="ask" /></button>
    <AskSheet open={open} onClose={() => setOpen(false)} subject={subject} />
  </>;
}
