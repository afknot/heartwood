import { useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';

// Reflect: the part of Heartwood about you, looking back. Debriefs, your career record and asking
// your journal share one tab; Settings lives here too, since it's mostly about you and your setup.
export const REFLECT_PATHS = /^\/(insights|career|ask|settings)(\/|$)/;
const KEY = 'hw:reflect';
export function lastReflect() {
  try { const v = localStorage.getItem(KEY); if (/^\/(insights|career|ask)$/.test(v || '')) return v; } catch { /* storage blocked */ }
  return '/insights';
}
const remember = to => { try { localStorage.setItem(KEY, to); } catch { /* storage blocked */ } };

export default function ReflectNav() {
  const { pathname } = useLocation();
  useEffect(() => { if (/^\/(insights|career|ask)$/.test(pathname)) remember(pathname); }, [pathname]);
  const link = (to, label) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'on' : '')}>{label}</NavLink>
  );
  return (
    <div className="hub-nav">
      <nav className="seg grow" aria-label="Reflect">
        {link('/insights', 'Debriefs')}
        {link('/career', 'Career')}
        {link('/ask', 'Ask')}
      </nav>
      <Link to="/settings" state={{ from: pathname }} className="icon-btn" aria-label="Settings" title="Settings"><Icon name="settings" /></Link>
    </div>
  );
}
