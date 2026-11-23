import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { useApp } from '../lib/context.js';
import { formatDate, safeHref, renderMarkdown } from '../lib/format.js';

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

// Front matter (the --- block at the top) is for your site's build, not for reading.
function readable(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md || '');
  if (!m) return md || '';
  const v = k => ((new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm').exec(m[1]) || [])[1] || '').trim();
  return `${v('title') ? `# ${v('title')}\n\n` : ''}${v('summary') ? `_${v('summary')}_\n\n` : ''}${md.slice(m[0].length)}`;
}
const readableHtml = md => renderMarkdown(readable(md)).replace(/<p>TODO:/g, '<p class="todo-line">TODO:');

/** Copy as formatted text, so headings and bullets survive a paste into Squarespace, Google Docs or Word. */
function CopyFormatted({ md }) {
  const { notify } = useApp();
  async function copy() {
    const html = readableHtml(md);
    const plain = Object.assign(document.createElement('div'), { innerHTML: html }).innerText;
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
      } else await navigator.clipboard.writeText(plain);
      notify('Copied as formatted text');
    } catch { notify('Couldn’t copy. Select the text and copy it instead.'); }
  }
  return <button className="btn small" onClick={copy}><Icon name="clip" size={16} /> Copy formatted</button>;
}

/** A story or self-review: read it rendered, or edit the Markdown. */
function TextDraft({ kind, c, set, connected, links, onDownload }) {
  const [mode, setMode] = useState('read');
  return (
    <section className="card copy-block">
      <div className="row mb" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={mode === 'read'} className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>Read</button>
          <button aria-pressed={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>Edit</button>
        </div>
        <span className="grow" />
        <CopyFormatted md={c} />
        <CopyButton text={c} label="Copy Markdown" />
        <button className={`btn small${connected || kind === 'review' ? '' : ' primary'}`} onClick={onDownload}><Icon name="note" size={16} /> Download .md</button>
        {kind === 'story' && safeHref(links.portfolio) && <a className="btn small ghost" href={safeHref(links.portfolio)} target="_blank" rel="noreferrer">Open your portfolio</a>}
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>{kind === 'review'
        ? 'Your self-review. Lines starting with TODO: are questions for you; fill them in or delete them before you submit it.'
        : 'The story file for your portfolio. Lines starting with TODO: are questions for you; fill them in or delete them before you publish.'}
        {' '}Copy formatted keeps headings and bullets for editors like Squarespace or Google Docs; Copy Markdown is for your site’s files.</p>
      {mode === 'read'
        ? <div className="prose story-read" dangerouslySetInnerHTML={{ __html: readableHtml(c) }} />
        : <textarea className="textarea mono" rows={24} value={c} onChange={e => set(e.target.value)} aria-label={kind === 'review' ? 'Self-review' : 'Story file'} autoFocus />}
    </section>
  );
}

const GIVEN_LABEL = { say: 'Said it', message: 'Sent them the message', team: 'Shared with the team', linkedin: 'LinkedIn post', recommendation: 'LinkedIn recommendation' };

/** Kudos, ready for each place it can go: your 1:1, a message to them, the team, LinkedIn. You copy; Heartwood never sends. */
function KudosDraft({ d, c, set, onSent }) {
  const first = c.person_name?.split(' ')[0] || 'them';
  const sent = Array.isArray(c.sent) ? c.sent : [];
  const done = to => sent.some(x => x.to === to);
  const given = to => api.post(`/career/drafts/${d.id}/given`, { to }).then(r => onSent(r.sent)).catch(() => {});
  const legacy = !c.direct && !c.channel && !c.say;
  const where = [...new Set(sent.map(x => GIVEN_LABEL[x.to]).filter(Boolean))];
  const Done = ({ to, label }) => (done(to)
    ? <span className="small muted"><Icon name="check" size={14} /> {GIVEN_LABEL[to]}</span>
    : <button className="btn small ghost" onClick={() => given(to)}>{label}</button>);
  return (
    <section className="card">
      <p className="small muted" style={{ marginTop: 0 }}>For {c.person_name}: {c.win}</p>
      {where.length > 0 && <p className="small" style={{ marginTop: -4 }}><Icon name="check" size={14} /> Given: {where.join(' · ')}</p>}
      {legacy && <p className="small muted">This kudos was made before Heartwood wrote versions for your 1:1, a message and the team. Make a new one from their page to get those.</p>}

      {c.say !== undefined && <>
        <CopyBlock label="Say it in your 1:1" value={c.say || ''} rows={3} onChange={v => set({ ...c, say: v })} />
        <div className="row" style={{ marginTop: -8, marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <span className="small muted grow">It’s on your next agenda with {first}, and in your prep.</span>
          <Done to="say" label="I said it" />
        </div>
      </>}
      {c.direct !== undefined && <>
        <CopyBlock label={`Message to ${first}`} value={c.direct || ''} rows={5} onChange={v => set({ ...c, direct: v })} />
        <div className="row" style={{ marginTop: -8, marginBottom: 12, justifyContent: 'flex-end' }}><Done to="message" label="I sent it" /></div>
      </>}
      {c.channel !== undefined && <>
        <CopyBlock label="Shout-out for the team" value={c.channel || ''} rows={4} onChange={v => set({ ...c, channel: v })} />
        <div className="row" style={{ marginTop: -8, marginBottom: 12, justifyContent: 'flex-end' }}><Done to="team" label="I shared it" /></div>
      </>}

      <CopyBlock label="LinkedIn post" value={c.post || ''} rows={7} share onShare={() => given('linkedin')} onChange={v => set({ ...c, post: v })} />
      <p className="small muted" style={{ marginTop: -8 }}>Open in LinkedIn starts a new post with this text. Edit it there, type @ and their name to tag {first}, then post when you’re ready.</p>
      <CopyBlock label="LinkedIn recommendation" value={c.recommendation || ''} rows={7} onChange={v => set({ ...c, recommendation: v })} />
      <div className="row" style={{ marginTop: -8, gap: 8, alignItems: 'flex-start' }}>
        <p className="small muted grow" style={{ margin: 0 }}>LinkedIn doesn’t let apps start a recommendation. Copy this, open their profile, choose More → Recommend, and paste.</p>
        <Done to="recommendation" label="I posted it" />
      </div>
      {c.notes && <p className="small muted">{c.notes}</p>}
    </section>
  );
}

// Drafts you've deleted but can still undo. The Drafts list hides them; the delete happens after the Undo toast.
export const deletingDrafts = new Set();
const pendingDeletes = new Map();
function deleteNow(id) {
  clearTimeout(pendingDeletes.get(id));
  pendingDeletes.delete(id);
  // keepalive so it still goes through if you close the app right after deleting.
  fetch(`/api/career/drafts/${id}`, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {});
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => [...pendingDeletes.keys()].forEach(deleteNow));

export default function CareerDraft() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [d, setD] = useState(null);
  const [saveState, setSaveState] = useState('');
  const [busy, setBusy] = useState('');
  const [gh, setGh] = useState(null);
  const [links, setLinks] = useState({});
  const latest = useRef(null);
  const dirty = useRef(false);
  const deleted = useRef(false);
  const timer = useRef();
  const inflight = useRef(null);

  useEffect(() => {
    deleted.current = false; dirty.current = false; setSaveState('');
    api.get(`/career/drafts/${id}`).then(setD).catch(e => notify(e.message));
    api.get('/career').then(r => { setGh(r.github); setLinks(r.links || {}); }).catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drafts save themselves, like notes: a moment after you stop typing, when you leave, or when the app goes to the background.
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    await inflight.current; // one save at a time, so Export and Delete never race a save that's still sending
    if (!dirty.current || deleted.current) return inflight.current;
    dirty.current = false;
    setSaveState('Saving…');
    inflight.current = api.patch(`/career/drafts/${id}`, { content: latest.current }).then(next => {
      setD(x => (x ? { ...x, flags: next.flags, updated_at: next.updated_at } : x));
      setSaveState(dirty.current ? '' : 'Saved');
    }, e => {
      dirty.current = true;
      setSaveState('Not saved');
      notify(e.message);
    }).finally(() => { inflight.current = null; });
    await inflight.current;
  }, [id, notify]);

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); save(); };
  }, [save]);

  if (!d) return <main className="page" />;
  const set = content => {
    setD(x => ({ ...x, content }));
    latest.current = content;
    dirty.current = true;
    setSaveState('');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 800);
  };
  const c = d.content;

  async function exportIt() {
    setBusy('export');
    try {
      await save();
      if (dirty.current) throw new Error('Couldn’t save your changes, so nothing was exported. Try again.');
      setD(await api.post(`/career/drafts/${id}/export`));
      notify('Pull request opened');
    } catch (e) { notify(e.message); }
    finally { setBusy(''); }
  }
  function download() {
    const slug = String(d.title || 'story').toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 60) || 'story';
    const url = URL.createObjectURL(new Blob([c], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${slug}.md` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove() {
    await save(); // so Undo brings back your latest edits
    deleted.current = true;
    const draftId = id;
    deletingDrafts.add(draftId);
    pendingDeletes.set(draftId, setTimeout(() => deleteNow(draftId), 6500));
    notify('Draft deleted', { action: { label: 'Undo', onClick: () => {
      clearTimeout(pendingDeletes.get(draftId));
      pendingDeletes.delete(draftId);
      deletingDrafts.delete(draftId);
      nav(`/career/drafts/${draftId}`);
    } } });
    nav('/career#drafts');
  }

  const pasted = d.kind === 'resume' && c.source === 'pasted';
  const exportable = d.kind === 'story' || (d.kind === 'resume' && !pasted);
  // Kept resume lines, grouped under their role, ready to paste.
  const keptLines = pasted ? [
    ...(c.summary && c.summary_accepted ? ['Summary', c.summary, ''] : []),
    ...[...new Set((c.changes || []).filter(x => x.accepted).map(x => x.role_label))].flatMap(role => [
      role || 'Experience',
      ...(c.changes || []).filter(x => x.accepted && x.role_label === role).map(x => `• ${x.text}${x.action === 'replace' ? `   (replaces: ${x.current})` : ''}`),
      ''
    ])
  ].join('\n').trim() : '';
  const connected = !!gh?.ready;

  return (
    <main className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav('/career#drafts')} aria-label="Back"><Icon name="back" /></button>
        <h1 style={{ fontSize: 22 }}>{d.title}</h1>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Written {formatDate(d.created_at)}{d.evidence_ids.length ? ` from ${d.evidence_ids.length} evidence item${d.evidence_ids.length > 1 ? 's' : ''}` : ''}.
        {saveState && <span className={saveState === 'Not saved' ? 'warn-text' : ''}> {saveState === 'Not saved' ? 'Not saved. Heartwood will try again when you next edit.' : saveState}</span>}
      </p>

      {d.flags.length > 0 && (
        <section className="mb" aria-label="Check before sharing">
          {d.flags.map((f, i) => (
            <div key={i} className={`banner ${f.level === 'warn' ? 'warn' : 'info'}`}><Icon name={f.level === 'warn' ? 'key' : 'check'} size={18} /><span className="grow">{f.text}</span></div>
          ))}
        </section>
      )}

      {d.pr_url && (
        <div className="banner info"><Icon name="check" size={18} /><span className="grow">Pull request opened. <a href={safeHref(d.pr_url)} target="_blank" rel="noreferrer">Review it on GitHub</a>. Nothing changes on your site until you merge it.</span></div>
      )}

      {(d.kind === 'story' || d.kind === 'review') && <TextDraft kind={d.kind} c={c} set={set} connected={connected} links={links} onDownload={download} />}

      {d.kind === 'resume' && (
        <section className="card">
          {pasted && (c.changes?.length > 0 || c.summary) && (
            <div className="row mb" style={{ flexWrap: 'wrap', gap: 8 }}>
              <p className="small muted grow" style={{ margin: 0 }}>For the resume you pasted. Untick the ones you don’t want, edit the rest, then copy them into your resume.</p>
              <CopyButton text={keptLines} label="Copy kept lines" />
            </div>
          )}
          {!c.changes?.length && !c.summary && <p className="muted">No changes suggested.</p>}
          {c.summary && (
            <div className="todo-row">
              <input type="checkbox" checked={!!c.summary_accepted} onChange={e => set({ ...c, summary_accepted: e.target.checked })} aria-label="Use the new summary" />
              <div className="grow">
                <div className="row"><span className="small muted grow" style={{ fontWeight: 600 }}>New summary</span>{pasted && <CopyButton text={c.summary} />}</div>
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
                  <div className="row"><span className="small muted grow" style={{ fontWeight: 600 }}>{x.action === 'replace' ? 'Replace a line' : 'Add a line'} · {x.role_label}</span>{pasted && <CopyButton text={x.text} />}</div>
                  {x.action === 'replace' && <p className="small muted" style={{ margin: '4px 0' }}><s>{x.current}</s></p>}
                  <textarea className="textarea mt" value={x.text} onChange={e => upd({ text: e.target.value })} />
                  <div className="row mt" style={{ flexWrap: 'wrap' }}>
                    {!pasted && c.format !== 'jsonresume' && <label className="row small" style={{ gap: 6 }}>Show on
                      <select className="select" value={x.visibility} onChange={e => upd({ visibility: e.target.value })} style={{ width: 'auto', minHeight: 34 }}>
                        <option value="resume">Resume only</option>
                        <option value="public">Resume and public site</option>
                      </select>
                    </label>}
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
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <p className="small muted grow" style={{ margin: 0 }}>Paste these into LinkedIn yourself. Heartwood never posts or edits your profile.</p>
            {safeHref(links.linkedin) && <a className="btn small primary" href={safeHref(links.linkedin)} target="_blank" rel="noreferrer">Open your profile</a>}
          </div>
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
        {exportable && connected && (
          <button className="btn primary" onClick={exportIt} disabled={!!busy}>
            {busy === 'export' ? <><span className="spinner" /> Opening pull request…</> : d.pr_url ? 'Export again' : 'Export to portfolio'}
          </button>
        )}
      </div>
      {exportable && gh && !connected && (
        <p className="small muted">Want pull requests to your portfolio instead? <Link to="/settings/career" state={{ from: 'here' }}>Connect a GitHub repository</Link>.</p>
      )}
    </main>
  );
}
