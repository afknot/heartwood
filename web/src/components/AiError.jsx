import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/** True when an AI job failed because no provider key is set yet. */
export const needsKey = message => /No API key set/i.test(String(message || ''));

/**
 * An AI job's error, shown right where you asked for it (the Reflection card, Prep, Ask, a debrief),
 * with a way to fix it when the fix is in Settings.
 */
export default function AiError({ message, onDismiss, className = '' }) {
  if (!message) return null;
  const text = String(message).replace(/^Analysis failed:\s*/, '');
  const key = needsKey(text);
  return (
    <div className={`banner error ai-error ${className}`} role="alert">
      <span className="grow">{key ? 'This needs an AI provider. Add an API key in Settings, then try again.' : text}</span>
      {key && <Link className="btn small" to="/settings/ai" state={{ from: 'here' }}>Add an API key</Link>}
      {onDismiss && <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss"><Icon name="x" size={18} /></button>}
    </div>
  );
}
