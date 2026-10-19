import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { formatDate } from '../lib/format.js';

// "2026-10-09 → 2026-10-16: Weekly debrief: …" -> "Week of Oct 9"
function debriefLabel(r) {
  const d = String(r.title || '').match(/(\d{4}-\d{2}-\d{2})/);
  if (!d) return String(r.title || '').replace(/:.*$/, '');
  const date = new Date(`${d[1]}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return /month/i.test(r.title) ? `Month from ${date}` : `Week of ${date}`;
}

/** You: everything about you and how you lead, with Settings at the bottom. */
export default function You() {
  const [s, setS] = useState(null);
  const [styles, setStyles] = useState([]);
  const [voice, setVoice] = useState(null);
  const [reports, setReports] = useState([]);
  const [chats, setChats] = useState([]);
  useEffect(() => {
    api.get('/settings').then(r => setS(r.settings)).catch(() => {});
    api.get('/leadership/styles').then(setStyles).catch(() => {});
    api.get('/voice').then(setVoice).catch(() => {});
    api.get('/reports').then(r => setReports(Array.isArray(r) ? r : r?.reports || [])).catch(() => {});
    api.get('/chats').then(setChats).catch(() => {});
  }, []);
  const picked = String(s?.profile?.leadership_styles || '').split(',').filter(Boolean);
  const styleNames = picked.map(k => styles.find(x => x.key === k)?.label).filter(Boolean);
  const exDone = voice?.counts?.exercise || 0, exTotal = voice?.exercises?.length || 7;
  const debriefs = reports.filter(r => r.kind === 'period').slice(0, 2);
  const row = (to, icon, title, sub, extra) => (
    <Link to={to} state={{ from: '/you' }} className="settings-row card you-row">
      <span className="ic"><Icon name={icon} size={18} /></span>
      <span className="grow"><b>{title}</b>{sub && <small>{sub}</small>}{extra}</span>
      <Icon name="chevron" size={18} />
    </Link>
  );
  return (
    <main className="page">
      <div className="topbar">
        <h1>You</h1>
        <Link to="/settings" state={{ from: '/you' }} className="icon-btn" aria-label="Settings" title="Settings"><Icon name="settings" /></Link>
      </div>
      {s?.profile?.name && <p className="muted" style={{ marginTop: -6 }}>{s.profile.name}{s.profile.role ? ` · ${s.profile.role}` : ''}</p>}

      <h2 className="section-title">How you lead</h2>
      {row('/settings/you', 'sparkle', 'Your leadership style', styleNames.length ? styleNames.join(' · ') : 'Choose the kind of leader you want to be')}
      {row('/you/voice', 'note', 'Your voice', voice?.profile?.summary ? `${voice.profile.summary.split('. ')[0]}.` : `${exDone} of ${exTotal} writing exercises · drafts sound more like you`,
        exDone < exTotal ? <span className="you-progress" aria-hidden="true"><span style={{ width: `${Math.round((exDone / exTotal) * 100)}%` }} /></span> : null)}

      <h2 className="section-title">Looking back</h2>
      {row('/insights', 'insights', 'Debriefs', debriefs[0] ? `Latest: ${debriefLabel(debriefs[0])}` : 'Weekly and monthly: themes, blind spots, how you’re trending')}
      {row('/career', 'career', 'Career record', 'Your initiatives, outcomes and leadership, ready for reviews and your portfolio')}

      <h2 className="section-title">Conversations</h2>
      <div className="card" style={{ padding: '6px 16px' }}>
        {chats.length === 0 && <p className="small muted">Questions you ask, from anywhere in Heartwood, are kept here and with the person, note or meeting they’re about.</p>}
        {chats.slice(0, 5).map(c => (
          <Link key={c.id} to={`/ask/${c.id}`} className="row you-chat">
            <span className="grow" style={{ minWidth: 0 }}><b>{c.title}</b><small className="muted"> · {formatDate(c.updated_at)}</small></span>
            <Icon name="chevron" size={16} />
          </Link>
        ))}
        <Link to="/ask" className="btn ghost small" style={{ paddingLeft: 0 }}><Icon name="ask" size={16} /> {chats.length ? 'All chats, or ask something new' : 'Ask something'}</Link>
      </div>

      <h2 className="section-title">Settings</h2>
      {row('/settings', 'settings', 'Settings', 'AI and transcription, meetings, notifications, backups, sign-in, updates')}
    </main>
  );
}
