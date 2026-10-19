import { useEffect, useState, useCallback } from 'react';
import { AppCtx } from './lib/context.js';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { flushPending } from './lib/pending.js';
import Icon from './components/Icon.jsx';
import { REFLECT_PATHS, lastReflect } from './components/ReflectNav.jsx';
import Login from './pages/Login.jsx';
import Journal from './pages/Journal.jsx';
import Entry from './pages/Entry.jsx';
import Record from './pages/Record.jsx';
import People from './pages/People.jsx';
import Person from './pages/Person.jsx';
import Insights from './pages/Insights.jsx';
import Report from './pages/Report.jsx';
import Ask from './pages/Ask.jsx';
import Settings from './pages/Settings.jsx';
import Import from './pages/Import.jsx';
import AddFiles from './pages/AddFiles.jsx';
import Today from './pages/Today.jsx';
import Schedule from './pages/Schedule.jsx';
import Career from './pages/Career.jsx';
import CareerDraft from './pages/CareerDraft.jsx';

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [people, setPeople] = useState([]);
  const [toast, setToast] = useState('');
  const loc = useLocation();

  const refreshPeople = useCallback(() => api.get('/people').then(setPeople).catch(() => {}), []);
  const notify = useCallback(msg => { setToast(msg); setTimeout(() => setToast(''), 2800); }, []);

  useEffect(() => {
    api.get('/auth/me').then(r => setAuthed(r.authed)).catch(() => setAuthed(false));
    const out = () => setAuthed(false);
    window.addEventListener('heartwood:logged-out', out);
    return () => window.removeEventListener('heartwood:logged-out', out);
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshPeople();
    const flush = () => flushPending().then(n => n && notify(`Uploaded ${n} saved recording${n > 1 ? 's' : ''}`));
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [authed, refreshPeople, notify]);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const hideTabs = /^\/(entry|record|import|add)/.test(loc.pathname);

  return (
    <AppCtx.Provider value={{ people, refreshPeople, notify }}>
      <div className="app">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/entry/:id" element={<Entry />} />
          <Route path="/record" element={<Record />} />
          <Route path="/people" element={<People />} />
          <Route path="/people/:id" element={<Person />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/insights/:id" element={<Report />} />
          <Route path="/ask" element={<Ask />} />
          <Route path="/ask/:chatId" element={<Ask />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/career" element={<Career />} />
          <Route path="/career/drafts/:id" element={<CareerDraft />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:section" element={<Settings />} />
          <Route path="/add" element={<AddFiles />} />
          <Route path="/import/:id" element={<Import />} />
          <Route path="*" element={<div className="page"><p>Not found. <Link to="/">Back to Today</Link></p></div>} />
        </Routes>
        {!hideTabs && <TabBar />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </AppCtx.Provider>
  );
}

function TabBar() {
  const loc = useLocation();
  const tab = (to, icon, label, end, active) => (
    <NavLink to={to} end={end} className={({ isActive }) => `tab${isActive || active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} /> <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        {tab('/', 'today', 'Today', true)}
        {tab('/journal', 'journal', 'Journal')}
        <Link to="/record" className="tab-record" aria-label="Record"><Icon name="mic" size={26} /></Link>
        {tab('/people', 'people', 'People')}
        {tab(lastReflect(), 'insights', 'Reflect', false, REFLECT_PATHS.test(loc.pathname))}
      </div>
    </nav>
  );
}
