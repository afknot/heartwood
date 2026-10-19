import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const MAX = 3;

/** Pick up to three leadership styles you're growing toward. Stored as "servant,space". */
export function StylePicker({ value, onChange }) {
  const [styles, setStyles] = useState(null);
  useEffect(() => { api.get('/leadership/styles').then(setStyles).catch(() => setStyles([])); }, []);
  const picked = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const toggle = key => {
    const next = picked.includes(key) ? picked.filter(k => k !== key) : picked.length < MAX ? [...picked, key] : picked;
    onChange(next.join(','));
  };
  if (!styles) return null;
  return (
    <fieldset className="field style-picker">
      <legend>The kind of leader you want to be</legend>
      <small style={{ display: 'block', marginBottom: 8 }}>Pick up to {MAX}. Coaching, prep, 1:1 agendas, the quote of the day and Something to try lean toward them.</small>
      <div className="style-grid">
        {styles.map(s => {
          const on = picked.includes(s.key);
          const full = !on && picked.length >= MAX;
          return (
            <button type="button" key={s.key} className={`style-option${on ? ' on' : ''}`} aria-pressed={on} disabled={full} onClick={() => toggle(s.key)}>
              <span className="style-check" aria-hidden="true">{on && <Icon name="check" size={13} />}</span>
              <span className="grow"><b>{s.label}</b><small>{s.short}</small></span>
            </button>
          );
        })}
      </div>
      {picked.length >= MAX && <small style={{ display: 'block', marginTop: 6 }}>That’s three. Tap one to swap it out.</small>}
    </fieldset>
  );
}
