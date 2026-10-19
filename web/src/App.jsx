import { useEffect, useState, useCallback } from 'react';
import { AppCtx } from './lib/context.js';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { flushPending } from './lib/pending.js';
import Icon from './components/Icon.jsx';
import { REFLECT_PATHS } from './components/ReflectNav.jsx';
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
import You from './pages/You.jsx';
import Voice from './pages/Voice.jsx';
import { AskSheet } from './components/ContextBar.jsx';

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
  // Ask is docked to the tab bar everywhere except Ask itself (which has its own box).
  const dock = !hideTabs && !/^\/ask(\/|$)/.test(loc.pathname);

  return (
    <AppCtx.Provider value={{ people, refreshPeople, notify }}>
      <div className={`app${dock ? ' has-dock' : ''}`}>
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
