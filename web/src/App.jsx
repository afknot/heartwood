import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { AppCtx } from './lib/context.js';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { startUploader } from './lib/pending.js';
import { watchViewport } from './lib/viewport.js';
import Icon from './components/Icon.jsx';
import { REFLECT_PATHS } from './components/ReflectNav.jsx';
import Login from './pages/Login.jsx';
import Journal from './pages/Journal.jsx';
import Today from './pages/Today.jsx';
import { AskSheet } from './components/ContextBar.jsx';

// Today, Journal and Login load with the app; the other screens load when first opened (the note
// editor alone is most of the app's size), then everything is fetched in the background so the
// app still works offline.
const LOADERS = {
  Entry: () => import('./pages/Entry.jsx'),
  Record: () => import('./pages/Record.jsx'),
  People: () => import('./pages/People.jsx'),
  Person: () => import('./pages/Person.jsx'),
  Insights: () => import('./pages/Insights.jsx'),
  Report: () => import('./pages/Report.jsx'),
  Ask: () => import('./pages/Ask.jsx'),
  Settings: () => import('./pages/Settings.jsx'),
  Import: () => import('./pages/Import.jsx'),
  AddFiles: () => import('./pages/AddFiles.jsx'),
  Schedule: () => import('./pages/Schedule.jsx'),
  Career: () => import('./pages/Career.jsx'),
  CareerDraft: () => import('./pages/CareerDraft.jsx'),
  You: () => import('./pages/You.jsx'),
  Voice: () => import('./pages/Voice.jsx')
};
const RELOADED = 'heartwood:chunk-reload';
const page = load => lazy(() => load().then(m => { try { window.sessionStorage.removeItem(RELOADED); } catch { /* private mode */ } return m; }).catch(err => {
  // After an update, an old screen's file is gone from the server: reload once to get the new app.
  let again = false;
  try { again = !window.sessionStorage.getItem(RELOADED); window.sessionStorage.setItem(RELOADED, '1'); } catch { /* private mode */ }
  if (again) { window.location.reload(); return new Promise(() => {}); }
  throw err;
}));
const Entry = page(LOADERS.Entry);
const Record = page(LOADERS.Record);
const People = page(LOADERS.People);
const Person = page(LOADERS.Person);
const Insights = page(LOADERS.Insights);
const Report = page(LOADERS.Report);
const Ask = page(LOADERS.Ask);
const Settings = page(LOADERS.Settings);
const Import = page(LOADERS.Import);
const AddFiles = page(LOADERS.AddFiles);
const Schedule = page(LOADERS.Schedule);
const Career = page(LOADERS.Career);
const CareerDraft = page(LOADERS.CareerDraft);
const You = page(LOADERS.You);
const Voice = page(LOADERS.Voice);
const prefetch = () => Object.values(LOADERS).forEach(load => load().catch(() => {}));

// Keep the tab bar and other fixed bars anchored on iPhone (see lib/viewport.js).
watchViewport();

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

  // After Heartwood updates, reload into the new version the next time you come back to it,
  // unless you're recording or writing (those screens pick it up when you leave them).
  useEffect(() => {
    if (!authed) return;
    let seen = null;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const v = await api.get('/health').then(r => r.version?.commit).catch(() => null);
      if (!v) return;
      if (seen && v !== seen && !/^\/(record|entry)/.test(window.location.pathname) && !document.querySelector('.sheet')) window.location.reload();
      seen = seen || v;
    };
    check();
    document.addEventListener('visibilitychange', check);
    const t = setInterval(check, 5 * 60e3);
    return () => { document.removeEventListener('visibilitychange', check); clearInterval(t); };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    refreshPeople();
    startUploader(n => notify(`Uploaded ${n} recording${n > 1 ? 's' : ''}. Transcribing now.`));
    // Once the first screen is up, quietly fetch the rest so later taps are instant (and offline works).
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
    const t = setTimeout(() => idle(prefetch), 2500);
    return () => clearTimeout(t);
  }, [authed, refreshPeople, notify]);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const hideTabs = /^\/(entry|record|import|add)/.test(loc.pathname);
  // Ask is docked to the tab bar everywhere except Ask itself (which has its own box).
  const dock = !hideTabs && !/^\/ask(\/|$)/.test(loc.pathname);

  return (
    <AppCtx.Provider value={{ people, refreshPeople, notify }}>
      <div className={`app${dock ? ' has-dock' : ''}`}>
        <Suspense fallback={<div className="page" aria-busy="true" />}>
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
          <Route path="/you" element={<You />} />
          <Route path="/you/voice" element={<Voice />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:section" element={<Settings />} />
          <Route path="/add" element={<AddFiles />} />
          <Route path="/import/:id" element={<Import />} />
          <Route path="*" element={<div className="page"><p>Not found. <Link to="/">Back to Today</Link></p></div>} />
        </Routes>
        </Suspense>
        {!hideTabs && <TabBar dock={dock} people={people} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </AppCtx.Provider>
  );
}

function TabBar({ dock, people }) {
  const loc = useLocation();
  const [ask, setAsk] = useState(null); // null | { listen }
  // On someone's page, the dock asks about them.
  const pid = loc.pathname.match(/^\/people\/([^/]+)$/)?.[1];
  const person = pid && people.find(p => p.id === pid);
  const subject = person ? { kind: 'person', id: person.id, label: person.name } : null;
  const tab = (to, icon, label, end, active) => (
    <NavLink to={to} end={end} className={({ isActive }) => `tab${isActive || active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} /> <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      {dock && (
        <div className="ask-dock">
          <div className="ask-dock-btn" role="group" aria-label="Ask">
            <button type="button" className="grow" style={{ all: 'unset', flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, minHeight: 42, overflow: 'hidden' }} onClick={() => setAsk({ listen: false })}>
              <Icon name="ask" size={18} /> <span className="grow">{subject ? `Ask about ${subject.label.split(' ')[0]}…` : 'Ask anything…'}</span>
            </button>
            <button type="button" className="ask-dock-mic" onClick={() => setAsk({ listen: true })} aria-label="Ask by voice"><Icon name="mic" size={17} /></button>
          </div>
          <AskSheet open={!!ask} onClose={() => setAsk(null)} subject={subject} listen={!!ask?.listen} />
        </div>
      )}
      <div className="tabbar-inner">
        {tab('/', 'today', 'Today', true)}
        {tab('/journal', 'journal', 'Journal')}
        <Link to="/record" className="tab-record" aria-label="Record"><Icon name="mic" size={26} /></Link>
        {tab('/people', 'people', 'Team')}
        {tab('/you', 'career', 'You', false, REFLECT_PATHS.test(loc.pathname))}
      </div>
    </nav>
  );
}
