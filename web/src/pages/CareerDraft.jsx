import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { useApp } from '../lib/context.js';
import { formatDate } from '../lib/format.js';

/** Copy text, falling back to selecting it when the clipboard isn't available. */
function CopyButton({ text, label = 'Copy' }) {
  const { notify } = useApp();
  async function copy(e) {
    try { await navigator.clipboard.writeText(text); notify('Copied'); }
    catch {
      const box = e.currentTarget.closest('.copy-block')?.querySelector('textarea');
      if (box) { box.focus(); box.select(); notify('Selected. Copy it from here.'); }
    }
  }
  return <button className="btn small" onClick={copy}><Icon name="clip" size={16} /> {label}</button>;
}

// Opens LinkedIn's post composer with the text filled in. Nothing is posted until you press Post there.
const linkedInShareUrl = text => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
// Opens a Teams chat with them, message filled in. You press Send in Teams.
const teamsChatUrl = (email, text) => `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}&message=${encodeURIComponent(text)}`;

const SENT_LABEL = { say: 'Said it in person', slack_dm: 'Slack message', slack_channel: 'Slack channel', teams_channel: 'Teams channel', teams_dm: 'Teams chat', linkedin: 'LinkedIn post', recommendation: 'LinkedIn recommendation' };

/** A send button that asks once before it sends. */
function SendButton({ label, confirm, onSend, disabled }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 6000); return () => clearTimeout(t); }, [armed]);
  if (!armed) return <button className="btn small primary" disabled={disabled || busy} onClick={() => setArmed(true)}>{busy ? <span className="spinner" /> : label}</button>;
  return (
    <button className="btn small primary" disabled={busy} onClick={async () => { setBusy(true); try { await onSend(); } finally { setBusy(false); setArmed(false); } }}>
      {busy ? <span className="spinner" /> : confirm}
    </button>
  );
}

/** Kudos, ready for each place it can go: your 1:1, a message to them, a team channel, LinkedIn. */
function KudosDraft({ d, c, set, onSent }) {
  const { notify } = useApp();
  const k = d.kudos || {};
  const first = c.person_name?.split(' ')[0] || 'them';
  const sent = Array.isArray(c.sent) ? c.sent : [];
  const done = to => sent.some(x => x.to === to);
  async function send(to, text) {
    try { const r = await api.post(`/career/drafts/${d.id}/send`, { to, text }); onSent(r.sent); notify(`Sent to ${r.where}`); }
    catch (e) { notify(e.message); }
  }
  const given = to => api.post(`/career/drafts/${d.id}/given`, { to }).then(r => onSent(r.sent)).catch(() => {});
  const legacy = !c.direct && !c.channel && !c.say;
  const where = [...new Set(sent.map(x => SENT_LABEL[x.to]).filter(Boolean))];
  return (
    <section className="card">
      <p className="small muted" style={{ marginTop: 0 }}>For {c.person_name}: {c.win}</p>
      {where.length > 0 && <p className="small" style={{ marginTop: -4 }}><Icon name="check" size={14} /> Given: {where.join(' · ')}</p>}
      {legacy && <p className="small muted">This kudos was made before Heartwood wrote versions for your 1:1, Slack and Teams. Make a new one from their page to get those.</p>}

      {c.say !== undefined && <>
        <CopyBlock label="Say it in your 1:1" value={c.say || ''} rows={3} onChange={v => set({ ...c, say: v })} />
        <div className="row" style={{ marginTop: -8, marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <span className="small muted grow">It’s on your next agenda with {first}, and in your prep.</span>
          {!done('say') && <button className="btn small" onClick={() => given('say')}>I said it</button>}
        </div>
      </>}

      {c.direct !== undefined && <>
        <CopyBlock label={`Message to ${first}`} value={c.direct || ''} rows={5} onChange={v => set({ ...c, direct: v })} />
        <div className="row" style={{ marginTop: -8, marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          {k.slack
            ? <SendButton label="Send on Slack" confirm={`Send to ${first} now`} disabled={!k.email || !c.direct?.trim()} onSend={() => send('slack_dm', c.direct)} />
            : <a className="btn small" href="slack://open" onClick={() => { navigator.clipboard?.writeText(c.direct || '').catch(() => {}); notify('Copied. Paste it into Slack.'); }}>Copy and open Slack</a>}
          {k.email
            ? <a className="btn small" href={teamsChatUrl(k.email, c.direct || '')} target="_blank" rel="noreferrer" onClick={() => given('teams_dm')}>Open in Teams</a>
            : null}
        </div>
        {(!k.email) && <p className="small muted" style={{ marginTop: -8 }}>Add {first}’s work email on their page to send this on Slack or open it in Teams.</p>}
        {!k.slack && <p className="small muted" style={{ marginTop: -8 }}>Connect Slack in Settings → Slack & Teams to send it as you, from here.</p>}
      </>}

      {c.channel !== undefined && <>
        <CopyBlock label="Team channel shout-out" value={c.channel || ''} rows={4} onChange={v => set({ ...c, channel: v })} />
        <div className="row" style={{ marginTop: -8, marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          {k.slack && k.slack_channel && <SendButton label={`Post in #${k.slack_channel.replace(/^#/, '')}`} confirm="Post it now" disabled={!c.channel?.trim()} onSend={() => send('slack_channel', c.channel)} />}
          {k.teams_channel && <SendButton label="Post in Teams channel" confirm="Post it now" disabled={!c.channel?.trim()} onSend={() => send('teams_channel', c.channel)} />}
          {!(k.slack && k.slack_channel) && !k.teams_channel && <span className="small muted">Set a Slack channel or a Teams channel in Settings → Slack & Teams to post this from here.</span>}
        </div>
      </>}

      <CopyBlock label="LinkedIn post" value={c.post || ''} rows={7} share onShare={() => given('linkedin')} onChange={v => set({ ...c, post: v })} />
      <p className="small muted" style={{ marginTop: -8 }}>Open in LinkedIn starts a new post with this text. Edit it there, type @ and their name to tag {first}, then post when you’re ready.</p>
      <CopyBlock label="LinkedIn recommendation" value={c.recommendation || ''} rows={7} onChange={v => set({ ...c, recommendation: v })} />
      <p className="small muted" style={{ marginTop: -8 }}>LinkedIn doesn’t let apps start a recommendation. Copy this, open their profile, choose More → Recommend, and paste.</p>
      {c.notes && <p className="small muted">{c.notes}</p>}
    </section>
  );
}

function CopyBlock({ label, value, onChange, limit, rows = 4, share = false, onShare }) {
  return (
    <div className="copy-block field">
      <div className="row" style={{ flexWrap: 'wrap' }}><span className="grow" style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        {limit && <span className={`small ${value.length > limit ? 'warn-text' : 'muted'}`}>{value.length} / {limit}</span>}
        <CopyButton text={value} />
        {share && <a className="btn small primary" href={linkedInShareUrl(value)} target="_blank" rel="noreferrer" onClick={onShare}>Open in LinkedIn</a>}
      </div>
      <textarea className="textarea" rows={rows} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

export default function CareerDraft() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [d, setD] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [gh, setGh] = useState(null);

  useEffect(() => {
    api.get(`/career/drafts/${id}`).then(setD).catch(e => notify(e.message));
    api.get('/career').then(r => setGh(r.github)).catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <main className="page" />;
  const set = content => { setD({ ...d, content }); setDirty(true); };
  const c = d.content;

  async function save() {
    setBusy('save');
    try { const next = await api.patch(`/career/drafts/${id}`, { content: d.content }); setD({ ...next, kudos: d.kudos }); setDirty(false); notify('Saved'); }
    catch (e) { notify(e.message); }
    finally { setBusy(''); }
  }
  async function exportIt() {
    setBusy('export');
    try {
      if (dirty) { await api.patch(`/career/drafts/${id}`, { content: d.content }); setDirty(false); }
      setD(await api.post(`/career/drafts/${id}/export`));
      notify('Pull request opened');
    } catch (e) { notify(e.message); }
    finally { setBusy(''); }
  }
  async function remove() {
    await api.del(`/career/drafts/${id}`);
    nav('/career#drafts');
  }

  const exportable = d.kind === 'story' || d.kind === 'resume';

  return (
    <main className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav('/career#drafts')} aria-label="Back"><Icon name="back" /></button>
        <h1 style={{ fontSize: 22 }}>{d.title}</h1>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>Written {formatDate(d.created_at)}{d.evidence_ids.length ? ` from ${d.evidence_ids.length} evidence item${d.evidence_ids.length > 1 ? 's' : ''}` : ''}.</p>

      {d.flags.length > 0 && (
        <section className="mb" aria-label="Check before sharing">
          {d.flags.map((f, i) => (
            <div key={i} className={`banner ${f.level === 'warn' ? 'warn' : 'info'}`}><Icon name={f.level === 'warn' ? 'key' : 'check'} size={18} /><span className="grow">{f.text}</span></div>
          ))}
        </section>
      )}

      {d.pr_url && (
        <div className="banner info"><Icon name="check" size={18} /><span className="grow">Pull request opened. <a href={d.pr_url} target="_blank" rel="noreferrer">Review it on GitHub</a>. Merging puts it on your staging site.</span></div>
      )}

      {d.kind === 'story' && (
        <section className="card">
          <p className="small muted" style={{ marginTop: 0 }}>The story file as it will appear in your portfolio. Edit freely. Lines starting with TODO: are questions for you; the portfolio won’t publish until they’re gone.</p>
          <textarea className="textarea mono" rows={24} value={c} onChange={e => set(e.target.value)} aria-label="Story file" />
        </section>
      )}

      {d.kind === 'resume' && (
        <section className="card">
          {!c.changes?.length && !c.summary && <p className="muted">No changes suggested.</p>}
          {c.summary && (
            <div className="todo-row">
              <input type="checkbox" checked={!!c.summary_accepted} onChange={e => set({ ...c, summary_accepted: e.target.checked })} aria-label="Use the new summary" />
              <div className="grow">
                <div className="small muted" style={{ fontWeight: 600 }}>New summary</div>
                <textarea className="textarea mt" value={c.summary} onChange={e => set({ ...c, summary: e.target.value })} />
              </div>
            </div>
          )}
          {(c.changes || []).map((x, i) => {
            const upd = patch => set({ ...c, changes: c.changes.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
            return (
              <div key={i} className="todo-row">
                <input type="checkbox" checked={!!x.accepted} onChange={e => upd({ accepted: e.target.checked })} aria-label={`Keep: ${x.text}`} />
                <div className="grow">
                  <div className="small muted" style={{ fontWeight: 600 }}>{x.action === 'replace' ? 'Replace a line' : 'Add a line'} · {x.role_label}</div>
                  {x.action === 'replace' && <p className="small muted" style={{ margin: '4px 0' }}><s>{x.current}</s></p>}
                  <textarea className="textarea mt" value={x.text} onChange={e => upd({ text: e.target.value })} />
                  <div className="row mt" style={{ flexWrap: 'wrap' }}>
                    <label className="row small" style={{ gap: 6 }}>Show on
                      <select className="select" value={x.visibility} onChange={e => upd({ visibility: e.target.value })} style={{ width: 'auto', minHeight: 34 }}>
                        <option value="resume">Resume only</option>
                        <option value="public">Resume and public site</option>
                      </select>
                    </label>
                    {x.why && <span className="small muted">{x.why}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {d.kind === 'linkedin' && (
        <section className="card">
          <p className="small muted" style={{ marginTop: 0 }}>Paste these into LinkedIn yourself. Heartwood never posts or edits your profile.</p>
          <CopyBlock label="Headline" value={c.headline || ''} limit={220} rows={2} onChange={v => set({ ...c, headline: v })} />
          <CopyBlock label="About" value={c.about || ''} limit={2600} rows={10} onChange={v => set({ ...c, about: v })} />
          <CopyBlock label={`Experience: ${c.experience?.title || ''}${c.experience?.org ? `, ${c.experience.org}` : ''}`}
            value={(c.experience?.bullets || []).map(b => `• ${b}`).join('\n')} rows={6}
            onChange={v => set({ ...c, experience: { ...c.experience, bullets: v.split('\n').map(l => l.replace(/^[•\-*]\s*/, '')).filter(Boolean) } })} />
          {(c.posts || []).map((p, i) => (
            <CopyBlock key={i} label={`Post idea: ${p.idea}`} value={p.draft} rows={6} share
              onChange={v => set({ ...c, posts: c.posts.map((q, j) => (j === i ? { ...q, draft: v } : q)) })} />
          ))}
          {c.notes && <p className="small muted">{c.notes}</p>}
        </section>
      )}

      {d.kind === 'recognition' && <KudosDraft d={d} c={c} set={set} onSent={sent => setD(x => ({ ...x, content: { ...x.content, sent } }))} />}

      <div className="row mt" style={{ flexWrap: 'wrap' }}>
        <button className="btn ghost danger" onClick={remove}><Icon name="trash" size={18} /> Delete draft</button>
        <span className="grow" />
        {dirty && <button className="btn" onClick={save} disabled={!!busy}>{busy === 'save' ? <span className="spinner" /> : 'Save changes'}</button>}
        {exportable && (
          <button className="btn primary" onClick={exportIt} disabled={!!busy || !gh?.ready}>
            {busy === 'export' ? <><span className="spinner" /> Opening pull request…</> : d.pr_url ? 'Export again' : 'Export to portfolio'}
          </button>
        )}
      </div>
      {exportable && gh && !gh.ready && <p className="small muted">Set up exports in Settings → Career record.</p>}
    </main>
  );
}
