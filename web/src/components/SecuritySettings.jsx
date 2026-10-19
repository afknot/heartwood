import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { formatDate } from '../lib/format.js';
import { useApp } from '../lib/context.js';
import { MeetingSheet } from './MeetingSheet.jsx';
import { useConnections } from './Connections.jsx';

// ---------- Calendar ----------
export function CalendarSettings() {
  const { notify } = useApp();
  const [st, setSt] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => { api.get('/calendar').then(setSt).catch(() => {}); }, []);

  async function connect(e) {
    e.preventDefault(); setBusy(true);
    try { setSt(await api.put('/calendar', { url })); setUrl(''); notify('Calendar connected'); }
    catch (x) { notify(x.message); }
    finally { setBusy(false); }
  }
  if (!st) return null;
  if (st.connected) return (
    <div className="card">
      <div className="row"><Icon name="calendar" /><b style={{ flex: 1 }}>Connected · {st.host}</b></div>
      <p className="small muted">{st.events} events in the next two weeks · synced {st.last_sync ? formatDate(st.last_sync, { time: true }) : 'not yet'}. Checks every 15 minutes.</p>
      {st.error && <div className="banner error" role="alert">{st.error}</div>}
      <div className="row wrap">
        <button className="btn small" disabled={busy} onClick={async () => { setBusy(true); setSt(await api.post('/calendar/sync')); setBusy(false); }}>{busy ? 'Syncing…' : 'Sync now'}</button>
        <button className="btn small danger" onClick={async () => { if (confirm('Disconnect your calendar? Heartwood forgets the link and the cached events.')) setSt(await api.del('/calendar')); }}>Disconnect</button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Add people’s work email on their page so invites match them, or Heartwood matches names in event titles.</p>
    </div>
  );
  return (
    <form className="card" onSubmit={connect}>
      <p style={{ marginTop: 0 }}>Paste your calendar’s private ICS link to see upcoming conversations on Today and prep for them.</p>
      <input className="input" type="url" autoCapitalize="none" spellCheck="false" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/calendar.ics or webcal://…" />
      <p className="small muted">Read-only. The link stays on your server and is never shown again. Treat it like a password.</p>
      <p className="small muted">Can’t share your calendar? <Link to="/schedule">Add your recurring 1:1s</Link> instead.</p>
      <div className="row wrap">
        <button className="btn primary small" disabled={!url.trim() || busy}>{busy ? 'Checking…' : 'Connect'}</button>
        <button type="button" className="btn ghost small" onClick={() => setHelp(!help)}>Where do I find it?</button>
      </div>
      {help && <div className="small" style={{ marginTop: 10 }}>
        <p><b>Outlook (web):</b> Settings → Calendar → Shared calendars → Publish a calendar. Choose your calendar and “Can view all details”, Publish, then copy the <b>ICS</b> link. If you don’t see Publish, your organization has turned it off.</p>
        <p><b>Google Calendar:</b> Settings → your calendar → Integrate calendar → copy “Secret address in iCal format”.</p>
        <p style={{ marginBottom: 0 }}><b>Apple iCloud:</b> Calendar app → share the calendar as Public, then copy the webcal link.</p>
      </div>}
    </form>
  );
}

// ---------- Passkeys ----------
export function PasskeySettings() {
  const { notify } = useApp();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  const load = () => api.get('/auth/passkeys').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const optionsJSON = await api.post('/auth/passkey/register/options');
      const response = await startRegistration({ optionsJSON });
      await api.post('/auth/passkey/register/verify', { response });
      notify('Passkey added. You can sign in with it now.');
      load();
    } catch (e) {
      if (e?.name !== 'NotAllowedError') notify(e.message || 'Couldn’t add a passkey.');
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="row"><Icon name="key" /><b style={{ flex: 1 }}>Passkeys</b></div>
      <p className="small muted">Sign in with Face ID, Touch ID or your device PIN instead of typing your password. Add one on each device you use.</p>
      {(list || []).map(k => (
        <div key={k.id} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ flex: 1 }}>{k.name || 'Passkey'}<br /><span className="small muted">Added {formatDate(k.created_at)}{k.last_used_at ? ` · last used ${formatDate(k.last_used_at).toLowerCase()}` : ''}</span></span>
          <button className="btn ghost small danger" onClick={async () => { if (confirm(`Remove the passkey “${k.name}”?`)) { await api.del(`/auth/passkeys/${encodeURIComponent(k.id)}`); load(); } }}>Remove</button>
        </div>
      ))}
      {supported
        ? <button className="btn small mt" onClick={add} disabled={busy}>{busy ? 'Waiting for your device…' : 'Add a passkey on this device'}</button>
        : <p className="small muted">This browser doesn’t support passkeys.</p>}
    </div>
  );
}

// ---------- Backups ----------
const ago = iso => {
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  return h < 1 ? 'less than an hour ago' : h < 36 ? `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} days ago`;
};
const mb = n => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** Backups: the nightly copy on this server, and the encrypted off-site copy with its real status. */
export function BackupSettings({ info: initial }) {
  const { notify } = useApp();
  const [info, setInfo] = useState(initial);
  const [waiting, setWaiting] = useState(''); // 'backup' | 'drive'
  useEffect(() => { setInfo(initial); }, [initial]);
  useEffect(() => {
    const d = initial?.drive, last = initial?.offsite?.last_attempt;
    if (d?.stage === 'connected' && (!last || Date.parse(d.at) > Date.parse(last))) setWaiting('backup');
  }, [initial]);
  // While something you started is running, check in every few seconds.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = setInterval(async () => {
      const next = await api.get('/backups').catch(() => null);
      if (!next) return;
      setInfo(next);
      const fresh = next.offsite && Date.parse(next.offsite.last_attempt) > started - 5000;
      const driveDone = ['waiting', 'connected', 'error', 'expired'].includes(next.drive?.stage) && Date.parse(next.drive?.at || 0) > started - 5000;
      const done = waiting === 'backup' ? (!next.requested && fresh) : waiting === 'drive' ? driveDone && (next.drive.stage !== 'connected' || fresh) : true;
      if (done || next.service_down || Date.now() - started > 60 * 60e3) { setWaiting(''); clearInterval(t); }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting]);
  if (!info) return null;
  const o = info.offsite;
  const stale = o?.last_success && Date.now() - Date.parse(o.last_success) > 2 * 864e5;
  const act = async (url, body, then) => {
    try { setInfo(await api.post(url, body)); if (then) setWaiting(then); return true; }
    catch (e) { notify(e.message); return false; }
  };
  // Connected after the last attempt: the first backup is under way, so don't show the old error.
  const justConnected = info.drive?.stage === 'connected' && (!o || Date.parse(info.drive.at) > Date.parse(o.last_attempt));
  const showDrive = info.location?.kind === 'gdrive' && (info.drive?.needs_connecting || ['starting', 'waiting', 'finishing', 'error', 'expired'].includes(info.drive?.stage) || (!o && info.drive?.stage !== 'connected' && waiting === 'drive'));

  return <>
    <div className="card">
      <p style={{ marginTop: 0 }}><b>On this server:</b> a fresh copy of your journal every night{info.last ? `, last ${formatDate(info.last, { time: true }).toLowerCase()}` : ''}.</p>
      {!info.enabled ? <BackupSetup onDone={next => { setInfo(next); if (next.location?.kind === 'gdrive') notify('Now connect Google Drive below'); }} /> : <>
        <p><b>Encrypted off-site backups:</b> to {info.location?.label}.</p>
        {info.service_down && <div className="banner warn" style={{ marginBottom: 8 }}><span className="grow small">The backup service isn’t responding. It starts again with the next update. If this stays, see README → Backups.</span></div>}
        {showDrive ? <DriveConnect info={info} waiting={waiting === 'drive'} act={act} /> : justConnected ? (
          <div className="banner info" style={{ margin: 0 }}><span className="spinner" /><span className="grow small">Google Drive is connected. The first backup is running now: it sets up the encrypted folder and uploads everything, so it can take a while. You can leave this page.</span></div>
        ) : !o ? (
          <div className="banner info" style={{ margin: 0 }}><span className="grow small">Waiting for the backup service to report in. It does after each run, and a minute or so after an update.</span></div>
        ) : o.ok && !stale ? (
          <div className="banner info" style={{ margin: 0 }}><Icon name="check" size={18} /><span className="grow small">
            Last backed up {ago(o.last_success)}{o.snapshots ? ` · ${o.snapshots} snapshot${o.snapshots === 1 ? '' : 's'} kept` : ''}{o.size ? ` · ${mb(o.size)} stored` : ''}.
          </span></div>
        ) : (
          <div className="banner error" role="alert" style={{ margin: 0 }}><span className="grow small">
            {o.ok ? `The last successful backup was ${ago(o.last_success)}.` : `The last backup, ${ago(o.last_attempt)}, didn’t go through: ${o.error || 'unknown error'}`}
            {o.last_success && !o.ok ? ` Last good one: ${ago(o.last_success)}.` : ''}
            {!o.ok && <><br /><span>Tap <b>Back up now</b> to try again. It clears anything left behind by an interrupted backup.</span></>}
          </span></div>
        )}
        {!o?.ok && info.log_tail && (
          <details className="small" style={{ marginTop: 8 }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>Details from the backup service</summary>
            <pre className="backup-log">{info.log_tail}</pre>
          </details>
        )}
        {!showDrive && <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => act('/backups/run', {}, 'backup')} disabled={!!waiting || info.requested}>{waiting === 'backup' || info.requested ? <><span className="spinner" /> Backing up…</> : 'Back up now'}</button>
          {info.location?.kind === 'gdrive' && <button className="btn small ghost" onClick={() => act('/backups/drive/start', {}, 'drive')} disabled={!!waiting}>Reconnect Google Drive</button>}
        </div>}
        {info.location?.kind === 'gdrive' && o?.ok && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            In Google Drive, look in My Drive for the folder <b>{info.location.folder}</b>. It holds encrypted pieces (folders named data, index, keys and snapshots), not readable files. That’s on purpose: only your backup passphrase can open them, and Google can’t read your journal.
          </p>
        )}
      </>}
    </div>
  </>;
}

/** Turn on encrypted backups: where, and a passphrase only you keep. */
function BackupSetup({ onDone }) {
  const { notify } = useApp();
  const [dest, setDest] = useState('gdrive');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = p1.length >= 12 && p1 === p2;
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { onDone(await api.post('/backups/setup', { passphrase: p1, destination: dest })); }
    catch (x) { notify(x.message); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={save}>
      <p><b>Encrypted off-site backups:</b> off. Turn them on so a dead disk or a lost server doesn’t take your journal with it. Everything is encrypted on this server before it leaves.</p>
      <div className="field"><span>Where</span>
        <div className="seg">
          <button type="button" aria-pressed={dest === 'gdrive'} className={dest === 'gdrive' ? 'on' : ''} onClick={() => setDest('gdrive')}>Google Drive</button>
          <button type="button" aria-pressed={dest === 'local'} className={dest === 'local' ? 'on' : ''} onClick={() => setDest('local')}>This server only</button>
        </div>
        <small>{dest === 'gdrive' ? 'Recommended. Heartwood can only see files it creates in your Drive, nothing else.' : 'Protects against mistakes, not a failed disk. You can switch to Drive later.'}</small>
      </div>
      <label className="field"><span>Backup passphrase</span>
        <input className="input" type="password" autoComplete="new-password" value={p1} onChange={e => setP1(e.target.value)} />
        <small>At least 12 characters. Save it in your password manager now: without it, the backups can’t be opened, by anyone.</small>
      </label>
      <label className="field"><span>Passphrase again</span>
        <input className="input" type="password" autoComplete="new-password" value={p2} onChange={e => setP2(e.target.value)} />
        {p2 && p1 !== p2 && <small style={{ color: 'var(--rec-text)' }}>Doesn’t match.</small>}
      </label>
      <button className="btn primary block" disabled={!ok || busy}>{busy ? 'Turning on…' : 'Turn on encrypted backups'}</button>
    </form>
  );
}

/** Connect Google Drive in two steps, no terminal: sign in to Google, then paste back where it sent you. */
function DriveConnect({ info, waiting, act }) {
  const [pasted, setPasted] = useState('');
  const d = info.drive || {};
  const stage = d.stage;
  return (
    <div className="drive-connect">
      {(info.drive?.needs_connecting && !['waiting', 'finishing'].includes(stage)) && <p className="small" style={{ marginTop: 0 }}>Google Drive isn’t connected yet, so nothing has been backed up off-site. It takes a minute.</p>}
      {stage === 'error' && <div className="banner error" role="alert" style={{ marginBottom: 8 }}><span className="grow small">{d.error || 'That didn’t work.'}</span></div>}
      {stage === 'expired' && <p className="small muted" style={{ marginTop: 0 }}>The last sign-in timed out. Start again.</p>}
      {stage === 'waiting' && d.auth_url ? <>
        <ol className="small steps">
          <li><a className="btn small primary" href={d.auth_url} target="_blank" rel="noopener noreferrer">Sign in to Google</a> and choose <b>Allow</b>.</li>
          <li>Google then opens a page that <b>won’t load</b> (it starts with <code>127.0.0.1:53682</code>). That’s expected. Copy the whole address from the address bar.</li>
          <li>Paste it here:</li>
        </ol>
        <form className="row" style={{ gap: 8 }} onSubmit={async e => { e.preventDefault(); if (await act('/backups/drive/finish', { url: pasted }, 'drive')) setPasted(''); }}>
          <input className="input" value={pasted} onChange={e => setPasted(e.target.value)} placeholder="http://127.0.0.1:53682/?state=…&code=…" aria-label="Address Google sent you to" autoCapitalize="none" spellCheck="false" />
          <button className="btn primary small" disabled={!pasted.trim() || waiting}>Connect</button>
        </form>
      </> : stage === 'finishing' || (waiting && stage !== 'error') ? (
        <p className="small" style={{ margin: 0 }}><span className="spinner" /> {stage === 'finishing' ? 'Connecting and running the first backup…' : 'Getting a sign-in link…'}</p>
      ) : (
        <button className="btn primary small" onClick={() => act('/backups/drive/start', {}, 'drive')}>Connect Google Drive</button>
      )}
    </div>
  );
}

/** Set up Heartwood's own mailbox, from Settings. */
function InviteSetup({ onDone }) {
  const { notify } = useApp();
  const [c, setC] = useConnections();
  const [f, setF] = useState({ invite_email: '', invite_password: '', invite_imap_host: '', invite_imap_port: '993' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (c) setF(x => ({ ...x, invite_email: c.invite_email?.value || '', invite_imap_host: c.invite_imap_host?.value || '', invite_imap_port: c.invite_imap_port?.value || '993' })); }, [c]);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      // Guess the mail server from the address if it's left empty: mail.<domain> is the usual cPanel name.
      const host = f.invite_imap_host.trim() || `mail.${f.invite_email.split('@')[1] || ''}`;
      setC(await api.put('/connections', { ...f, invite_imap_host: host, ...(f.invite_password ? {} : { invite_password: undefined }) }));
      notify('Saved. Checking the mailbox…');
      setTimeout(onDone, 4000);
    } catch (x) { notify(x.message); }
    finally { setBusy(false); }
  }
  return (
    <form className="card" onSubmit={save}>
      <p style={{ marginTop: 0 }}>Give Heartwood its own email address, then add it to your 1:1s (or forward a meeting to it). New meetings, new times and cancellations show up on Today.</p>
      <p className="small muted">Create a mailbox for it with your email host first, like <code>heartwood@yourdomain</code>. Heartwood never replies or RSVPs. Everyone on an invite can see the addresses on it, including this one.</p>
      <label className="field"><span>Mailbox address</span><input className="input" type="email" autoCapitalize="none" value={f.invite_email} onChange={set('invite_email')} placeholder="heartwood@yourdomain.com" required /></label>
      <label className="field"><span>Mailbox password</span><input className="input" type="password" autoComplete="new-password" value={f.invite_password} onChange={set('invite_password')} placeholder={c?.invite_password?.set ? 'Saved. Type to replace it.' : ''} required={!c?.invite_password?.set} /></label>
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: 2 }}><span>Mail server <small>(IMAP)</small></span><input className="input" autoCapitalize="none" value={f.invite_imap_host} onChange={set('invite_imap_host')} placeholder={f.invite_email.includes('@') ? `mail.${f.invite_email.split('@')[1]}` : 'mail.yourdomain.com'} /></label>
        <label className="field" style={{ flex: 1 }}><span>Port</span><input className="input" inputMode="numeric" value={f.invite_imap_port} onChange={set('invite_imap_port')} /></label>
      </div>
      <button className="btn primary block" disabled={busy || !f.invite_email}>{busy ? 'Saving…' : 'Save and check'}</button>
      <p className="small muted" style={{ marginBottom: 0 }}>Then add your work address under Allowed senders, so only your invites are read.</p>
    </form>
  );
}

/** Meeting invites: Heartwood's own mailbox (set up in .env), what it has picked up, and a manual check. */
export function InviteSettings() {
  const { notify } = useApp();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newSender, setNewSender] = useState('');
  const [open, setOpen] = useState(null); // meeting uid
  useEffect(() => { api.get('/invites').then(setSt).catch(() => {}); }, []);
  if (!st) return null;
  if (!st.configured) return <InviteSetup onDone={() => api.get('/invites').then(setSt)} />;
  async function check() {
    setBusy(true);
    try { const r = await api.post('/invites/check'); setSt(r); if (!r.error) notify('Checked'); } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }
  const r = st.last_result;
  async function allow(sender) {
    setBusy(true);
    try { setSt(await api.post('/invites/allowed', { sender })); setNewSender(''); notify(`Allowed ${sender}`); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }
  const domainOf = a => (a.includes('@') ? `@${a.split('@')[1]}` : '');
  return (
    <div className="card">
      <p style={{ marginTop: 0 }}>Add <b style={{ userSelect: 'all' }}>{st.address}</b> to a meeting, or forward one to it. Heartwood checks every 5 minutes.</p>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small" type="button" onClick={() => navigator.clipboard?.writeText(st.address).then(() => notify('Address copied'))}>Copy address</button>
        <button className="btn small" type="button" onClick={check} disabled={busy}>{busy ? <><span className="spinner" /> Checking…</> : 'Check now'}</button>
      </div>
      {st.error && <div className="banner error" role="alert" style={{ marginTop: 10 }}>{st.error}</div>}
      <p className="small muted">
        {st.last_check ? `Last checked ${formatDate(st.last_check, { time: true }).toLowerCase()}` : 'Not checked yet'}
        {r && r.messages > 0 ? ` · ${r.messages} new email${r.messages > 1 ? 's' : ''}${r.ignored ? `, ${r.ignored} ignored` : ''}` : ''}
      </p>
      {st.skipped?.length > 0 && (
        <div className="banner warn" style={{ marginTop: 10, display: 'block' }}>
          <b>Skipped emails</b>
          {st.skipped.map(k => (
            <div key={k.sender + k.outcome} className="small" style={{ marginTop: 6 }}>
              {k.n} from {k.sender || 'an unknown sender'}: {{
                not_allowed: 'not an allowed sender.',
                failed_auth: 'failed sender checks (SPF/DMARC), so it may not really be from them.',
                no_invite: 'no meeting invite attached.',
                error: 'couldn’t be read. Heartwood will try again.'
              }[k.outcome]}
              {k.outcome === 'not_allowed' && k.sender && (
                <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                  <button type="button" className="btn small" disabled={busy} onClick={() => allow(k.sender)}>Allow {k.sender}</button>
                  <button type="button" className="btn small ghost" disabled={busy} onClick={() => allow(domainOf(k.sender))}>Allow everyone at {domainOf(k.sender)}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="day-label" style={{ margin: '10px 0 2px' }}>Allowed senders</div>
      <p className="small muted" style={{ margin: '0 0 6px' }}>Only invites from these addresses are read. Use @domain for everyone at an organization.</p>
      <div className="chips">
        {st.allowed.map(a => st.allowed_env.includes(a)
          ? <span key={a} className="chip" title="Set in .env on the server">{a} <small className="muted">.env</small></span>
          : <span key={a} className="chip">{a}
              <button type="button" aria-label={`Remove ${a}`} style={{ border: 0, background: 'none', padding: '0 0 0 4px', color: 'inherit', cursor: 'pointer' }}
                onClick={async () => setSt(await api.del(`/invites/allowed?sender=${encodeURIComponent(a)}`))}><Icon name="x" size={13} /></button>
            </span>)}
        {!st.allowed.length && <span className="small muted">None yet. Add your work address.</span>}
      </div>
      <form className="row" style={{ gap: 8, marginTop: 8 }} onSubmit={e => { e.preventDefault(); if (newSender.trim()) allow(newSender.trim()); }}>
        <input className="input" style={{ flex: 1, minWidth: 0 }} type="text" inputMode="email" autoCapitalize="none" spellCheck="false"
          value={newSender} onChange={e => setNewSender(e.target.value)} placeholder="you@work.example or @work.example" />
        <button className="btn small" disabled={busy || !newSender.trim()}>Add</button>
      </form>
      {st.meetings.length > 0 && <>
        <div className="day-label" style={{ margin: '10px 0 2px' }}>Meetings it knows about</div>
        {st.meetings.map(m => (
          <div key={m.uid} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--line)', opacity: m.cancelled ? 0.55 : 1 }}>
            <span className="grow" style={{ minWidth: 0, cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => setOpen(m.uid)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(m.uid); } }}>
              <b style={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</b>
              <span className="small muted">{m.cancelled ? 'Cancelled' : m.next ? `Next ${new Date(m.next).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Nothing in the next two weeks'}</span>
            </span>
            <button className="icon-btn" type="button" aria-label={`Forget ${m.title}`} title="Forget this meeting" onClick={async () => setSt(await api.del(`/invites/${encodeURIComponent(m.uid)}`))}><Icon name="x" size={18} /></button>
          </div>
        ))}
      </>}
      {open && <MeetingSheet uid={open} onClose={() => setOpen(null)} />}
      <p className="small muted" style={{ marginBottom: 0 }}>Tap a meeting to choose who’s in it. Only the title, time, location and attendees are kept. Reading the mailbox in webmail is fine. Descriptions, join links and attachments are dropped, and the emails are deleted from the mailbox after a week.</p>
    </div>
  );
}

const b64ToBytes = s => { const pad = '='.repeat((4 - (s.length % 4)) % 4); const raw = window.atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };

/** Phone notifications: turn on for this device, morning summary, heads-up before each conversation. */
export function NotificationSettings() {
  const { notify } = useApp();
  const [st, setSt] = useState(null);
  const [here, setHere] = useState(null); // this device's subscription endpoint, if any
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    api.get('/push').then(setSt).catch(() => {});
    if (supported) navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setHere(s?.endpoint || null)).catch(() => {});
  }, [supported]);

  async function enable() {
    setBusy(true);
    try {
      const perm = await window.Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are blocked for Heartwood. Allow them in your phone’s settings, then try again.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(st.public_key) });
      setSt({ ...st, ...(await api.post('/push/subscribe', { subscription: sub.toJSON() })) });
      setHere(sub.endpoint);
      await api.post('/push/test', {});
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api.post('/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setHere(null); setSt({ ...st, devices: Math.max(0, (st.devices || 1) - 1) });
    } finally { setBusy(false); }
  }
  async function save(patch) {
    const next = { ...st.settings, ...patch };
    setSt({ ...st, settings: next });
    api.put('/push/settings', next).then(r => setSt(s => ({ ...s, ...r }))).catch(e => notify(e.message));
  }
  if (!st) return null;
  const n = st.settings;

  return (
    <div className="card">
      {!supported || (ios && !standalone) ? (
        <p style={{ marginTop: 0 }} className="small">
          {ios && !standalone ? 'Open Heartwood from its Home Screen icon to turn on notifications (iPhone only allows them for Home Screen apps).' : 'This browser can’t receive notifications.'}
        </p>
      ) : here ? (
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="grow small">On for this device{st.devices > 1 ? ` (and ${st.devices - 1} other${st.devices > 2 ? 's' : ''})` : ''}.</span>
          <button type="button" className="btn small ghost" disabled={busy} onClick={disable}>Turn off here</button>
        </div>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>Get a short summary on mornings you have conversations, with prep already written.</p>
          <button type="button" className="btn primary small" disabled={busy} onClick={enable}>{busy ? 'Turning on…' : 'Turn on for this device'}</button>
        </>
      )}
      <div className="toggle" style={{ cursor: 'default', flexWrap: 'wrap' }}>
        <span className="grow">Morning summary<small>On days with conversations with your people.</small></span>
        <label className="switch"><input type="checkbox" checked={n.morning} onChange={e => save({ morning: e.target.checked })} aria-label="Morning summary" /><i /></label>
        {n.morning && <div className="row" style={{ gap: 8, width: '100%' }}>
          <span className="small muted">At</span>
          <input className="input" type="time" value={n.morning_time} onChange={e => e.target.value && save({ morning_time: e.target.value })} style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} aria-label="Summary time" />
        </div>}
      </div>
      <label className="toggle">
        <span className="grow">Write prep ahead of time<small>Each conversation’s prep is ready when the summary arrives. Uses your AI provider.</small></span>
        <span className="switch"><input type="checkbox" checked={n.auto_prep} onChange={e => save({ auto_prep: e.target.checked })} /><i /></span>
      </label>
      <div className="toggle" style={{ cursor: 'default', flexWrap: 'wrap' }}>
        <span className="grow">Heads-up before each one<small>Tap it to open that conversation’s prep.</small></span>
        <label className="switch"><input type="checkbox" checked={n.before} onChange={e => save({ before: e.target.checked })} aria-label="Heads-up before each conversation" /><i /></label>
        {n.before && <div className="row" style={{ gap: 8, width: '100%' }}>
          <select className="select" value={n.before_min} onChange={e => save({ before_min: Number(e.target.value) })} style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} aria-label="Minutes before">
            {[5, 10, 15, 30].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
          <span className="small muted">before</span>
        </div>}
      </div>
      <label className="toggle">
        <span className="grow">Right after each one<small>“How did it go?” with one tap to record a quick note. Skipped if you’ve already written something.</small></span>
        <span className="switch"><input type="checkbox" checked={n.after} onChange={e => save({ after: e.target.checked })} /><i /></span>
      </label>
      <div className="toggle" style={{ cursor: 'default', flexWrap: 'wrap' }}>
        <span className="grow">Weekly debrief<small>Written for you each week: patterns, who needs attention, what’s coming due. Shows on Today too.</small></span>
        <label className="switch"><input type="checkbox" checked={n.weekly} onChange={e => save({ weekly: e.target.checked })} aria-label="Weekly debrief" /><i /></label>
        {n.weekly && <div className="row" style={{ gap: 8, width: '100%' }}>
          <select className="select" value={n.weekly_day} onChange={e => save({ weekly_day: Number(e.target.value) })} style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} aria-label="Day">
            {['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'].map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <input className="input" type="time" value={n.weekly_time} onChange={e => e.target.value && save({ weekly_time: e.target.value })} style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} aria-label="Time" />
          <button type="button" className="btn small ghost nowrap" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const r = await api.post('/push/test', { kind: 'weekly' }); notify('This week’s debrief is ready'); window.location.assign(`/insights/${r.report_id}`); }
            catch (e) { notify(e.message); } finally { setBusy(false); }
          }}>{busy ? 'Writing…' : 'Write it now'}</button>
        </div>}
      </div>
      <div className="toggle" style={{ cursor: 'default', flexWrap: 'wrap' }}>
        <span className="grow">End-of-day reflection<small>Weekdays: a nudge to take two minutes on how the day went. Skipped if you’ve already reflected. Also shows on Today.</small></span>
        <label className="switch"><input type="checkbox" checked={n.evening !== false} onChange={e => save({ evening: e.target.checked })} aria-label="End-of-day reflection" /><i /></label>
        {n.evening !== false && <div className="row" style={{ gap: 8, width: '100%' }}>
          <span className="small muted">At</span>
          <input className="input" type="time" value={n.evening_time || '17:30'} onChange={e => e.target.value && save({ evening_time: e.target.value })} style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} aria-label="Reflection time" />
        </div>}
      </div>
      <label className="toggle">
        <span className="grow">Show names on the lock screen<small>Off: “Conversation in 15 min”, no names.</small></span>
        <span className="switch"><input type="checkbox" checked={n.show_names} onChange={e => save({ show_names: e.target.checked })} /><i /></span>
      </label>
      {st.devices > 0 && <button type="button" className="btn small" style={{ marginTop: 8 }} disabled={busy} onClick={async () => { const r = await api.post('/push/test', { kind: 'morning' }); notify(r.sent ? 'Sent today’s summary' : 'No device received it'); }}>Send today’s summary now</button>}
      <p className="small muted" style={{ marginBottom: 0 }}>Times use the server’s time zone ({st.tz}). Notifications are encrypted to your device.</p>
    </div>
  );
}

/** Updates from GitHub: what's running, what's new, install now or automatically. */
export function UpdateSettings() {
  const { notify } = useApp();
  const [u, setU] = useState(null);
  const [waiting, setWaiting] = useState(false); // asked for an update; watching for it to land
  const [startCommit, setStartCommit] = useState(null);
  const [reqAt, setReqAt] = useState(null);
  const load = () => api.get('/updates').then(r => { setU(r); return r; });
  useEffect(() => { load().then(r => setStartCommit(r.running?.commit || null)).catch(() => {}); }, []);

  // While an update is pending or installing, check every few seconds (the app restarts briefly).
  useEffect(() => {
    if (!waiting && u?.status?.state !== 'updating') return;
    const t = setInterval(() => {
      load().then(r => {
        if (startCommit && r.running?.commit && r.running.commit !== startCommit && r.status?.state !== 'updating') {
          setWaiting(false);
          notify(`Updated to ${r.running.commit}. Reloading…`);
          setTimeout(() => window.location.reload(), 1200);
        } else if (r.status?.state === 'failed') setWaiting(false);
        else if (reqAt && r.status?.state === 'idle' && r.status.checked_at >= reqAt && !(r.status.available || []).length) {
          setWaiting(false); notify('Already up to date');
        }
      }).catch(() => { /* restarting */ });
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, u?.status?.state, startCommit, reqAt]);

  if (!u) return null;
  if (!u.set_up) return (
    <div className="card">
      <p style={{ marginTop: 0 }} className="small">Updates from GitHub aren’t set up on this server yet. On the server, run <code>./deploy/connect-github.sh</code> once.</p>
    </div>
  );
  const st = u.status;
  const avail = st.available || [];
  const updating = st.state === 'updating' || waiting;
  const when = iso => (iso ? formatDate(iso, { time: true }).toLowerCase() : '');

  async function updateNow() {
    try { await api.post('/updates/now'); setReqAt(new Date(Date.now() - 2000).toISOString().replace(/\.\d+Z$/, 'Z')); setWaiting(true); setStartCommit(u.running?.commit || st.current?.commit); notify('Update requested. It starts within a minute.'); }
    catch (e) { notify(e.message); }
  }
  async function setAuto(auto) {
    setU({ ...u, auto });
    try { await api.put('/updates/settings', { auto }); } catch (e) { notify(e.message); }
  }

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="grow">
          <b style={{ fontWeight: 600 }}>{updating ? 'Updating…' : avail.length ? `${avail.length} update${avail.length === 1 ? '' : 's'} available` : 'Up to date'}</b>
          <span className="small muted" style={{ display: 'block' }}>
            Running {u.running?.commit || st.current?.commit}{u.running?.at ? `, installed ${when(u.running.at)}` : ''} · checked {when(st.checked_at)}
          </span>
        </span>
        {updating ? <span className="spinner" /> : (
          <button type="button" className={`btn small${avail.length ? ' primary' : ''}`} onClick={updateNow}>{avail.length ? 'Update now' : 'Check now'}</button>
        )}
      </div>
      {updating && <p className="small muted" style={{ margin: '8px 0 0' }}>Heartwood restarts for a few seconds while it installs. This page reloads when it’s done.</p>}
      {st.state === 'failed' && !updating && <div className="banner error" role="alert" style={{ display: 'block', marginTop: 10 }}>
        {st.error || 'The last update didn’t finish.'}
        {st.log_tail && <details style={{ marginTop: 6 }}><summary className="small">Show log</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', maxHeight: 220, overflow: 'auto' }}>{st.log_tail}</pre></details>}
      </div>}
      {avail.length > 0 && !updating && <ul className="small" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
        {avail.slice(0, 8).map(c => <li key={c.commit}>{c.subject} <span className="muted">· {formatDate(c.date).toLowerCase()}</span></li>)}
        {avail.length > 8 && <li className="muted">+ {avail.length - 8} more</li>}
      </ul>}
      <label className="toggle" style={{ marginTop: 6 }}>
        <span className="grow">Install updates automatically<small>Off: you’ll see what’s new here and choose when to install.</small></span>
        <span className="switch"><input type="checkbox" checked={u.auto} onChange={e => setAuto(e.target.checked)} /><i /></span>
      </label>
    </div>
  );
}
