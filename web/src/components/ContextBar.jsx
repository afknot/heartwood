import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Sheet from './Sheet.jsx';
import AskComposer from './AskComposer.jsx';
import { ComposeSheet } from './Compose.jsx';
import { useDictation, DictationPanel, MicButton } from './VoiceInput.jsx';
import { formatDate, renderMarkdown } from '../lib/format.js';
import { useApp } from '../lib/context.js';

const LINK = { entry: id => `/entry/${id}`, person: id => `/people/${id}`, schedule: id => `/schedule?edit=${id}`, meeting: id => `/?meeting=${encodeURIComponent(id)}` };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** An answer's [E3] / [P2] labels as links to what they cite. */
export function answerHtml(m) {
  const map = Object.fromEntries((m.sources || []).map(s => [s.ref, s]));
  return renderMarkdown(m.content).replace(/\[([EPRM]\d+)\]/g, (all, ref) => {
    const s = map[ref];
    if (!s || !LINK[s.type || 'entry']) return '';
    const to = LINK[s.type || 'entry'](s.id);
    const label = (s.type || 'entry') === 'entry' ? (s.title || 'note').slice(0, 28) : s.title;
    return `<a class="ref ref-${esc(s.type || 'entry')}" href="${esc(to)}" data-go="${esc(to)}" title="${esc(s.title || '')}">${esc(label || ref)}</a>`;
  });
}

/** A chat about one thing (a person, a note, a meeting), or about anything when `subject` is empty. */
export function ChatPanel({ subject, chatId, onChat, ideas = [], listen = false }) {
  const nav = useNavigate();
  const { notify } = useApp();
  const [chat, setChat] = useState(null);
  const [busy, setBusy] = useState(false);
  const end = useRef();
  useEffect(() => {
    if (!chatId) { setChat(null); return; }
    if (chat?.id !== chatId) api.get(`/chats/${chatId}`).then(setChat).catch(() => setChat(null));
  }, [chatId]);
  const msgs = chat?.messages || [];
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length, busy]);
  const base = subject ? [{ type: subject.kind === 'meeting' ? 'meeting' : subject.kind, id: subject.id, label: subject.label }] : [];
  async function send({ question, refs = [], attachments = [] }) {
    const all = [...base, ...refs.filter(r => !base.some(b => b.type === r.type && b.id === r.id))];
    setChat(c => ({ ...(c || {}), messages: [...(c?.messages || []), { role: 'user', content: question || 'About the attached files', refs, attachments }] }));
    setBusy(true);
    try {
      const r = await api.post('/ask', { chat_id: chat?.id || null, question, refs: all, attachments: attachments.map(a => a.id), subject: subject ? { kind: subject.kind, id: subject.id } : null });
      const next = await api.get(`/chats/${r.chat_id}`);
      setChat(next); onChat?.(next);
    } catch (e) {
      notify(e.message);
      setChat(c => ({ ...c, messages: (c?.messages || []).slice(0, -1) }));
    } finally { setBusy(false); }
  }
  const onClick = e => { const a = e.target.closest('a[data-go]'); if (a) { e.preventDefault(); nav(a.dataset.go); } };
  return (
    <div className="chat-panel">
      {!msgs.length && ideas.length > 0 && (
        <div className="stack" style={{ gap: 6, marginBottom: 10 }}>
          {ideas.map(i => <button key={i} type="button" className="btn small" style={{ justifyContent: 'flex-start', fontWeight: 500 }} onClick={() => send({ question: i })}>{i}</button>)}
        </div>
      )}
      <div className="chat" onClick={onClick} aria-live="polite">
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="msg-user-wrap"><div className="msg-user">{m.content}</div></div>
          : <div key={i} className="msg-ai md" dangerouslySetInnerHTML={{ __html: answerHtml(m) }} />)}
        {busy && <div className="row muted small"><span className="spinner" /> Looking through your journal…</div>}
        <div ref={end} />
      </div>
      <div className="chat-panel-composer">
        <AskComposer busy={busy} autoListen={listen} placeholder={msgs.length ? 'Follow up…' : subject ? `Ask about ${subject.label}…` : 'Ask, or type @ to mention…'} onSend={send} />
      </div>
    </div>
  );
}

const IDEAS = {
  person: first => [`How is ${first} doing lately?`, `What have I promised ${first} and not done?`, `What should I bring up with ${first} next time?`],
  entry: () => ['What did I miss here?', 'What should I follow up on from this?', 'How did I show up in this?'],
  meeting: () => ['What should I prepare for this?', 'What came out of the last one?', 'What’s still open from this meeting?']
};

const GENERAL = ['What have I promised and not done?', 'Who on my team needs more from me?', 'Help me prepare for a hard conversation'];

/** Ask about this, in a sheet. Chats stay with the subject. */
export function AskSheet({ open, onClose, subject, chatId: initial = null, listen = false }) {
  const [chatId, setChatId] = useState(initial);
  useEffect(() => { if (open) setChatId(initial); }, [open, initial]);
  const first = subject?.label?.split(' ')[0] || '';
  return (
    <Sheet open={open} onClose={onClose} title={subject ? `Ask about ${subject.label}` : 'Ask'}>
      {open && <ChatPanel subject={subject} chatId={chatId} onChat={c => setChatId(c.id)} listen={listen} ideas={subject ? IDEAS[subject.kind]?.(first) || [] : GENERAL} />}
      {chatId && <Link className="btn ghost small" style={{ marginTop: 6 }} to={`/ask/${chatId}`} onClick={onClose}>Open in full screen</Link>}
    </Sheet>
  );
}

/** Updates and clarifications that belong with this person, note or meeting (not in your journal). */
export function ContextThread({ subject, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const d = useDictation({ onText: t => setText(x => (x.trim() ? `${x.trimEnd()} ${t}` : t)) });
  const load = () => api.get(`/context/${subject.kind}/${encodeURIComponent(subject.id)}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [subject.kind, subject.id, refreshKey]);
  async function add(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await api.post(`/context/${subject.kind}/${encodeURIComponent(subject.id)}`, { text });
    setText(''); setAdding(false); load();
  }
  async function remove(r) { if (!confirm('Delete this?')) return; await api.del(`/context-notes/${r.id}`); load(); }
  if (!rows) return null;
  const SRC = { update: 'Update', sent: 'Sent', moved: 'Update', you: '' };
  return (
    <div className="ctx-thread">
      <div className="row" style={{ gap: 8 }}>
        <span className="eyebrow grow">Context</span>
        {!adding && <button type="button" className="btn ghost small" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add</button>}
      </div>
      {adding && (
        <form onSubmit={add} className="ctx-add">
          {d.state !== 'idle' ? <DictationPanel d={d} /> : (
            <textarea className="textarea" rows={2} autoFocus value={text} onChange={e => setText(e.target.value)}
              placeholder={`Something to remember about ${subject.label}. It won’t show in your journal.`} aria-label="Add context" />
          )}
          <div className="row" style={{ gap: 6 }}>
            <MicButton d={d} />
            <span className="grow" />
            <button type="button" className="btn small ghost" onClick={() => { setAdding(false); setText(''); }}>Cancel</button>
            <button className="btn small primary" disabled={!text.trim()}>Save</button>
          </div>
        </form>
      )}
      {rows.length === 0 && !adding && <p className="small muted" style={{ margin: '2px 0 0' }}>Updates and clarifications about {subject.label} go here, not in your journal. Ask, prep and drafted messages use them.</p>}
      <ul className="ctx-list">
        {rows.slice(0, 8).map(r => (
          <li key={r.id}>
            <span className="small muted">{formatDate(r.at)}{SRC[r.source] ? ` · ${SRC[r.source]}` : ''}</span>
            <p>{r.text}</p>
            <button type="button" className="chip-x" onClick={() => remove(r)} aria-label="Delete"><Icon name="x" size={13} /></button>
          </li>
        ))}
      </ul>
      {rows.length > 8 && <p className="small muted">+ {rows.length - 8} older</p>}
    </div>
  );
}

/** "Ask about this" and "Write a message" for a person, note or meeting, plus its chats and context. */
export default function ContextBar({ subject, recipients = [], showThread = true, compact = false, showAsk = true }) {
  const [ask, setAsk] = useState(null); // null | { chatId }
  const [write, setWrite] = useState(false);
  const [chats, setChats] = useState([]);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    api.get(`/chats?subject_kind=${subject.kind}&subject_id=${encodeURIComponent(subject.id)}`).then(setChats).catch(() => setChats([]));
  }, [subject.kind, subject.id, ask, bump]);
  const canWrite = subject.kind !== 'entry' || recipients.length > 0;
  return (
    <section className={`card ctx-bar${compact ? ' compact' : ''}`} aria-label={`Ask about or write to ${subject.label}`}>
      <div className="ctx-actions">
        {showAsk && <button type="button" className="ctx-btn" onClick={() => setAsk({ chatId: null })}><Icon name="ask" size={18} /> Ask about this</button>}
        {canWrite && <button type="button" className="ctx-btn" onClick={() => setWrite(true)}><Icon name="send" size={18} /> Write a message</button>}
      </div>
      {chats.length > 0 && (
        <ul className="ctx-chats" aria-label="Chats">
          {chats.slice(0, 3).map(c => (
            <li key={c.id}><button type="button" className="linklike" onClick={() => setAsk({ chatId: c.id })}>{c.title}</button> <span className="small muted">· {formatDate(c.updated_at)}</span></li>
          ))}
        </ul>
      )}
      {showThread && <ContextThread subject={subject} refreshKey={bump} />}
      <AskSheet open={!!ask} onClose={() => setAsk(null)} subject={subject} chatId={ask?.chatId || null} />
      <ComposeSheet open={write} onClose={() => setWrite(false)} subject={subject} recipients={recipients} onSent={() => setBump(b => b + 1)} />
    </section>
  );
}
