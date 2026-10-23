import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { useApp } from '../lib/context.js';
import { formatDate } from '../lib/format.js';
import { lastReflect } from '../components/ReflectNav.jsx';
import { AIKeys, KeyField, useConnections } from '../components/Connections.jsx';
import { StylePicker, InspirationPicker } from '../components/LeadershipStyles.jsx';
import { CalendarSettings, InviteSettings, NotificationSettings, PasskeySettings, BackupSettings, UpdateSettings } from '../components/SecuritySettings.jsx';

const AI = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
const STT = { local: 'Local Whisper', openai: 'OpenAI', gemini: 'Gemini' };

const SECTIONS = [
  { k: 'you', icon: 'people', title: 'About you', sub: 'Your role, team, goals and leadership style, so coaching fits you' },
  { k: 'meetings', icon: 'calendar', title: 'Meetings & calendar', sub: 'Recurring 1:1s, meeting invites, calendar link' },
  { k: 'notifications', icon: 'today', title: 'Notifications', sub: 'Morning summary, before and after meetings, weekly debrief' },
  { k: 'ai', icon: 'sparkle', title: 'AI & transcription', sub: 'Providers, models and what runs automatically' },
  { k: 'career', icon: 'career', title: 'Career export', sub: 'Your portfolio repository for stories and resume updates' },
  { k: 'data', icon: 'archive', title: 'Your data & backups', sub: 'Export everything, encrypted backups' },
  { k: 'security', icon: 'key', title: 'Sign-in & security', sub: 'Passkeys, password, sign out' },
  { k: 'updates', icon: 'retry', title: 'Updates', sub: 'Automatic updates and the version you’re on' }
];
// Old links pointed at sections of one long page.
const LEGACY = { career: 'career', calendar: 'meetings', invites: 'meetings', notifications: 'notifications', updates: 'updates' };

export default function Settings() {
  const nav = useNavigate();
  const loc = useLocation();
  const { section } = useParams();
  const { notify } = useApp();
  const [s, setS] = useState(null);
  const [avail, setAvail] = useState(null);
  const [backups, setBackups] = useState(null);
  const [saved, setSaved] = useState('');
  const [version, setVersion] = useState(null);
  useEffect(() => { api.get('/health').then(h => setVersion(h.version)).catch(() => {}); }, []);
  const timer = useRef();

  const reload = () => api.get('/settings').then(r => { setS(r.settings); setAvail(r.available); setBackups(r.backups); });
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const old = LEGACY[loc.hash.slice(1)];
    if (!section && old) nav(`/settings/${old}`, { replace: true });
  }, [loc.hash, section, nav]);
  useEffect(() => { window.scrollTo(0, 0); }, [section]);

  function update(patch, { debounce = false } = {}) {
    const next = { ...s, ...patch };
    setS(next);
    clearTimeout(timer.current);
    const go = () => api.put('/settings', patch).then(r => { setS(r.settings); setSaved('Saved'); setTimeout(() => setSaved(''), 1500); }).catch(e => notify(e.message));
    if (debounce) timer.current = setTimeout(() => api.put('/settings', next).then(() => { setSaved('Saved'); setTimeout(() => setSaved(''), 1500); }).catch(e => notify(e.message)), 700);
    else go();
  }

  async function logout() {
    await api.post('/auth/logout');
    window.location.href = '/';
  }

  // Back always goes up one level: a section returns to the Settings list (the same history entry
  // when you came from it, so the list's own back still leaves Settings), and the list returns to
  // wherever you opened Settings from, or Reflect.
  function back() {
    if (section) return loc.state?.fromList || loc.state?.from ? nav(-1) : nav('/settings', { replace: true });
    if (loc.state?.from) return nav(-1);
    nav(lastReflect(), { replace: true });
  }

  const meta = SECTIONS.find(x => x.k === section);
  const header = (
    <div className="topbar">
      <button className="icon-btn" onClick={back} aria-label={section ? 'Back to Settings' : 'Back'}><Icon name="back" /></button>
      <h1>{meta ? meta.title : 'Settings'}</h1>
      <span className="small muted" role="status">{saved}</span>
    </div>
  );

  if (!section || !meta) {
    return (
      <main className="page">
        {header}
        <div className="card settings-list">
          {SECTIONS.map(x => (
            <Link key={x.k} to={`/settings/${x.k}`} state={{ fromList: true }} className="settings-row">
              <span className="ic"><Icon name={x.icon} size={18} /></span>
              <span className="grow"><b>{x.title}</b><small>{x.sub}</small></span>
              <Icon name="chevron" size={18} />
            </Link>
          ))}
        </div>
        {version && <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>Version {version.commit} · updated {formatDate(version.at, { time: true }).toLowerCase()}</p>}
      </main>
    );
  }

  if (!s || !avail) return <main className="page">{header}</main>;
  const prof = k => e => update({ profile: { ...s.profile, [k]: e.target.value } }, { debounce: true });

  return (
    <main className="page">
      {header}

      {section === 'you' && <>
        <p className="muted small" style={{ marginTop: -4 }}>This context makes the coaching specific to you. It stays on your server and is sent only to the AI provider you choose.</p>
        <label className="field"><span>Your name</span><input className="input" value={s.profile.name} onChange={prof('name')} /></label>
        <label className="field"><span>Role</span><input className="input" value={s.profile.role} onChange={prof('role')} placeholder="Your title" /></label>
        <label className="field"><span>Your team</span><textarea className="textarea" value={s.profile.team} onChange={prof('team')} placeholder="Size, what they do, where they are as a team" /></label>
        <label className="field"><span>Current goals</span><textarea className="textarea" value={s.profile.goals} onChange={prof('goals')} placeholder="What you and the team are trying to achieve right now" /></label>
        <StylePicker value={s.profile.leadership_styles} onChange={v => update({ profile: { ...s.profile, leadership_styles: v } })} />
        <InspirationPicker />
        <label className="field"><span>In your own words</span><textarea className="textarea" value={s.profile.leadership_aspirations} onChange={prof('leadership_aspirations')} placeholder="e.g. Give my leads more room to decide, more direct with feedback, calmer under pressure" /></label>
        <p className="small muted">Your manager is whoever you’ve marked as <i>Manager</i> in People. Follow-ups from conversations with them rank higher on Today.</p>
      </>}

      {section === 'meetings' && <>
        <Link to="/schedule" className="settings-row card" style={{ padding: '12px 16px', marginBottom: 8 }}>
          <span className="ic"><Icon name="repeat" size={18} /></span>
          <span className="grow"><b>Recurring 1:1s</b><small>Your regular conversations, without linking a calendar</small></span>
          <Icon name="chevron" size={18} />
        </Link>
        <h2 className="section-title">Meeting invites</h2>
        <InviteSettings />
        <h2 className="section-title">Calendar</h2>
        <CalendarSettings />
      </>}

      {section === 'notifications' && <NotificationSettings />}

      {section === 'ai' && <>
        <h2 className="section-title" style={{ marginTop: 4 }}>API keys</h2>
        <AIKeys onChanged={reload} />
        <h2 className="section-title">AI for reflection</h2>
        <div className="seg mb">
          {Object.entries(AI).map(([k, v]) => <button key={k} disabled={!avail.analysis[k]} aria-pressed={s.ai_provider === k} className={s.ai_provider === k ? 'on' : ''} onClick={() => update({ ai_provider: k })}>{v}</button>)}
        </div>
        <label className="field"><span>{AI[s.ai_provider]} model</span>
          <input className="input" value={s.models[s.ai_provider] || ''} autoCapitalize="none" spellCheck="false"
            onChange={e => update({ models: { ...s.models, [s.ai_provider]: e.target.value } }, { debounce: true })} />
          <small>Model names change often. Paste a current one from your provider’s docs if you get a “model not found” error.</small>
        </label>
        {!Object.values(avail.analysis).some(Boolean) && <div className="banner warn">Add at least one API key above to turn on reflection, prep and Ask.</div>}

        <h2 className="section-title">Transcription</h2>
        <div className="seg mb">
          {Object.entries(STT).map(([k, v]) => <button key={k} disabled={!avail.transcription[k]} aria-pressed={s.transcribe_provider === k} className={s.transcribe_provider === k ? 'on' : ''} onClick={() => update({ transcribe_provider: k })}>{v}</button>)}
        </div>
        {s.transcribe_provider === 'local'
          ? <p className="small muted">Runs on your server. Audio never leaves your house. Slower on CPU; long recordings can take a while.</p>
          : <label className="field"><span>{STT[s.transcribe_provider]} transcription model</span>
            <input className="input" value={s.transcribe_models[s.transcribe_provider] || ''} autoCapitalize="none" spellCheck="false"
              onChange={e => update({ transcribe_models: { ...s.transcribe_models, [s.transcribe_provider]: e.target.value } }, { debounce: true })} />
            <small>Audio is sent to {STT[s.transcribe_provider]} for transcription.</small>
          </label>}

        <h2 className="section-title">Automation & privacy</h2>
        <div className="card" style={{ padding: '4px 16px' }}>
          <Toggle label="Reflect automatically after recording" hint="Runs the AI reflection as soon as a transcript is ready." checked={s.auto_analyze} onChange={v => update({ auto_analyze: v })} />
          <Toggle label="Auto-organize" hint="Fill in missing titles, add tags, and link people the AI recognizes. Never overwrites what you set." checked={s.auto_organize} onChange={v => update({ auto_organize: v })} />
          <Toggle label="Live coach while recording" hint="Suggests questions to ask, things to say and commitments to note during 1:1s, conversations and meetings. You can still turn it off for one recording." checked={s.live_coach !== false} onChange={v => update({ live_coach: v })} />
          <Toggle label="Delete audio after transcribing" hint="Keep only the text. Saves space and limits what’s stored." checked={s.delete_audio_after_transcribe} onChange={v => update({ delete_audio_after_transcribe: v })} />
        </div>

        <h2 className="section-title">Usage, last 30 days</h2>
        <AIUsage />
      </>}

      {section === 'career' && <>
        <p className="muted small" style={{ marginTop: -4 }}>Lets Heartwood open pull requests on your portfolio repository with story drafts and resume updates you approve. It never changes your main branch, and your journal never leaves this server.</p>
        <CareerSettings career={s.career || {}} onChange={c => update({ career: { ...s.career, ...c } }, { debounce: true })} />
      </>}

      {section === 'data' && <>
        <h2 className="section-title" style={{ marginTop: 4 }}>Export</h2>
        <div className="row wrap">
          <a className="btn" href="/api/export.md" download><Icon name="note" size={18} /> Export Markdown</a>
          <a className="btn" href="/api/export.json" download>Export JSON</a>
        </div>
        <h2 className="section-title">Backups</h2>
        <BackupSettings info={backups} />
      </>}

      {section === 'security' && <>
        <PasskeySettings />
        <div className="mt" />
        <PasswordForm notify={notify} />
        <SignedIn onEverywhere={() => { window.location.href = '/'; }} />
        <button className="btn block danger mt-l" onClick={logout}>Sign out</button>
      </>}

      {section === 'updates' && <>
        <UpdateSettings />
        {version && <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>Version {version.commit} · updated {formatDate(version.at, { time: true }).toLowerCase()}</p>}
      </>}
    </main>
  );
}

function PasswordForm({ notify }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const mismatch = f.confirm && f.next !== f.confirm;
  const ready = f.current && f.next.length >= 12 && f.next === f.confirm;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.post('/auth/password', { current: f.current, next: f.next });
      setF({ current: '', next: '', confirm: '' });
      notify('Password changed. Other devices were signed out.');
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit}>
      <label className="field"><span>Current password</span>
        <input className="input" type="password" autoComplete="current-password" value={f.current} onChange={set('current')} />
      </label>
      <label className="field"><span>New password</span>
        <input className="input" type="password" autoComplete="new-password" value={f.next} onChange={set('next')} />
        <small>At least 12 characters. A few random words works well.</small>
      </label>
      <label className="field"><span>Confirm new password</span>
        <input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />
        {mismatch && <small style={{ color: 'var(--rec-text)' }}>Doesn’t match.</small>}
      </label>
      {err && <p className="small" style={{ color: 'var(--rec-text)', marginTop: 0 }}>{err}</p>}
      <button className="btn primary block" disabled={!ready || busy}>{busy ? 'Saving…' : 'Change password'}</button>
      <p className="small muted" style={{ marginBottom: 0 }}>Changing it signs out every other device. Forgot it? See “Reset your password” in the README.</p>
    </form>
  );
}

const tokens = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));

/** How many AI calls and tokens Heartwood used, and how much the cache saved. */
function AIUsage() {
  const [u, setU] = useState(null);
  useEffect(() => { api.get('/ai/usage?days=30').then(setU).catch(() => setU(false)); }, []);
  if (u === null) return <p className="small muted">Loading…</p>;
  if (!u || !u.calls) return <p className="small muted">No AI calls recorded yet. Counts start from this update.</p>;
  const inTotal = u.input + u.cache_read + u.cache_write;
  const cached = inTotal ? Math.round((u.cache_read / inTotal) * 100) : 0;
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <p style={{ margin: 0 }}><strong>{u.calls}</strong> call{u.calls === 1 ? '' : 's'} · {tokens(inTotal)} read · {tokens(u.output)} written</p>
      {cached > 0 && <p className="small muted" style={{ margin: '4px 0 0' }}>{cached}% of what was read came from the cache, at about a tenth of the price.</p>}
      {u.by_task?.length > 0 && <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {u.by_task.map(t => <li key={t.task}>{t.task[0].toUpperCase() + t.task.slice(1)}: {t.calls} · {tokens(t.input + t.cache_read)} in, {tokens(t.output)} out</li>)}
      </ul>}
    </div>
  );
}

/** How many devices are signed in, and a way to sign them all out (lost phone, shared computer). */
function SignedIn({ onEverywhere }) {
  const [n, setN] = useState(null);
  useEffect(() => { api.get('/auth/sessions').then(r => setN(r.count)).catch(() => {}); }, []);
  async function everywhere() {
    if (!confirm('Sign out every device, including this one? You’ll sign in again here with your password or passkey.')) return;
    await api.post('/auth/logout-everywhere').catch(() => {});
    onEverywhere();
  }
  return (
    <div className="card mt" style={{ padding: '12px 16px' }}>
      <b>Signed-in devices</b>
      <p className="small muted" style={{ margin: '4px 0 8px' }}>{n == null ? '…' : `${n} device${n === 1 ? '' : 's'} signed in, including this one.`} If you lose a phone or signed in somewhere you shouldn’t have, sign out everywhere.</p>
      <button className="btn small danger" onClick={everywhere}>Sign out everywhere</button>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle">
      <span className="grow">{label}{hint && <small>{hint}</small>}</span>
      <span className="switch"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} /><i /></span>
    </label>
  );
}

function CareerSettings({ career, onChange }) {
  const [gh, setGh] = useState(null);
  const [conn, setConn] = useConnections();
  useEffect(() => { api.get('/career').then(r => setGh(r.github)).catch(() => {}); }, [career.repo]);
  return <>
    <label className="field"><span>Portfolio repository</span>
      <input className="input" value={career.repo || ''} onChange={e => onChange({ repo: e.target.value.trim() })} placeholder="owner/repository" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
    </label>
    <label className="field"><span>Branch to open pull requests against</span>
      <input className="input" value={career.branch || 'main'} onChange={e => onChange({ branch: e.target.value.trim() })} autoCapitalize="off" spellCheck="false" />
    </label>
    {conn && <div className="card" style={{ marginBottom: 12 }}>
      <KeyField name="github_token" info={conn.github_token} label="GitHub token" test="github" onSaved={next => { setConn(next); api.get('/career').then(r => setGh(r.github)).catch(() => {}); }}
        help="A fine-grained token limited to your portfolio repository, with Contents and Pull requests set to Read and write." link="https://github.com/settings/personal-access-tokens/new" />
    </div>}
    {gh && (
      <div className={`banner ${gh.ready ? 'info' : 'warn'}`}>
        <Icon name={gh.ready ? 'check' : 'key'} size={18} />
        <span className="grow">{gh.ready ? 'Ready to export.' : gh.token ? 'Add your repository above to export.' : 'Add the GitHub token above to export.'}</span>
      </div>
    )}
  </>;
}
