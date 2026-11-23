import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';

// The four things that make Heartwood work well, in the order they matter.
export const SETUP_STEPS = [
  { k: 'ai', section: 'ai', title: 'Add an AI provider', why: 'Reflections, prep and Ask need a Claude, OpenAI or Gemini key.' },
  { k: 'you', section: 'you', title: 'Tell Heartwood about you', why: 'Your role and team, so coaching fits you instead of anyone.' },
  { k: 'backups', section: 'data', title: 'Turn on backups', why: 'An encrypted copy off this server, so a dead disk doesn’t take your journal.' },
  { k: 'passkey', section: 'security', title: 'Add a passkey', why: 'Sign in with Face ID or Touch ID instead of typing your password.' }
];

/** What's set up, from the server. Null until it loads. */
export function useSetup() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/setup').then(setS).catch(() => {}); }, []);
  return s;
}

const HIDE = 'hw:setup-hidden';

/** A checklist on Today until everything's done, or you hide it. */
export default function SetupCard() {
  const s = useSetup();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE) === '1'; } catch { return false; } });
  if (!s || hidden) return null;
  const left = SETUP_STEPS.filter(x => !s[x.k]);
  if (!left.length) return null;
  const done = SETUP_STEPS.length - left.length;
  const hide = () => { setHidden(true); try { localStorage.setItem(HIDE, '1'); } catch { /* storage blocked */ } };
  return (
    <section className="card setup-card" aria-labelledby="setup-head">
      <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
        <h2 id="setup-head" className="grow" style={{ margin: 0, fontSize: 17 }}>Finish setting up</h2>
        <span className="small muted">{done} of {SETUP_STEPS.length} done</span>
      </div>
      <ul className="setup-list">
        {SETUP_STEPS.map(x => (
          <li key={x.k} className={s[x.k] ? 'done' : ''}>
            <span className="setup-mark" aria-hidden="true">{s[x.k] ? <Icon name="check" size={14} /> : null}</span>
            {s[x.k]
              ? <span className="grow"><s>{x.title}</s><span className="sr-only"> (done)</span></span>
              : <Link className="grow" to={`/settings/${x.section}`} state={{ from: 'here' }}><b>{x.title}</b><small>{x.k === 'backups' && s.backups_failing ? 'Backups are on but the last one failed. Check what went wrong.' : x.why}</small></Link>}
          </li>
        ))}
      </ul>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn small ghost" onClick={hide}>Hide this</button>
      </div>
    </section>
  );
}
