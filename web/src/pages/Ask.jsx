import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import ReflectNav from '../components/ReflectNav.jsx';
import Sheet from '../components/Sheet.jsx';
import AskComposer from '../components/AskComposer.jsx';
import { formatDate, renderAnswer, inAppPath } from '../lib/format.js';
import { useApp } from '../lib/context.js';

const LINK = { entry: id => `/entry/${id}`, person: id => `/people/${id}`, schedule: id => `/schedule?edit=${id}`, meeting: id => `/?meeting=${encodeURIComponent(id)}` };
const REF_ICON = { person: 'people', entry: 'note', schedule: 'repeat', meeting: 'calendar' };

const IDEAS = [
  'What follow-ups have I promised and not closed?',
  'How have my 1:1s and check-ins been going?',
  'What patterns do you see in the tensions I write about?',
  'Help me prepare for a hard conversation',
  'Who haven’t I recognized recently?'
];

export default function Ask() {
  const { chatId } = useParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [chat, setChat] = useState(null); // { id, title, archived, messages }
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const end = useRef();

  useEffect(() => {
    if (!chatId) { setChat(null); return; }
    if (chat?.id === chatId) return;
    api.get(`/chats/${chatId}`).then(setChat).catch(e => { notify(e.message); nav('/ask', { replace: true }); });
  }, [chatId]);

  const msgs = chat?.messages || [];
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length, busy]);

  async function send({ question, refs = [], attachments = [] }) {
    if ((!question && !attachments.length) || busy) return;
    const shown = question || 'What do you make of this?';
    const userMsg = { role: 'user', content: shown, ...(refs.length ? { refs } : {}), ...(attachments.length ? { attachments } : {}) };
    const optimistic = { ...(chat || { id: null, title: shown, archived: false }), messages: [...msgs, userMsg] };
    setChat(optimistic); setBusy(true);
    try {
      const r = await api.post('/ask', { chat_id: chat?.id || null, question, refs, attachments: attachments.map(a => a.id) });
      const next = { id: r.chat_id, title: r.title, archived: false, messages: [...optimistic.messages, { role: 'assistant', content: r.answer, sources: r.sources }] };
      setChat(next);
      if (!chatId) nav(`/ask/${r.chat_id}`, { replace: true });
    } catch (e) {
      notify(e.message);
      setChat(chat);
    } finally { setBusy(false); }
  }

  async function archive(archived) {
    const c = await api.patch(`/chats/${chat.id}`, { archived });
    setChat(c);
    notify(archived ? 'Chat archived' : 'Chat restored');
    if (archived) nav('/ask');
  }

  // Turn [E3] / [P2] / [R1] references into links to the note, person or recurring meeting.
  function onClick(e) {
    const a = e.target.closest('a[data-go]');
    if (a) { e.preventDefault(); const to = inAppPath(a.dataset.go); if (to) nav(to); }
  }
  const html = m => renderAnswer(m.content, m.sources);

  return (
    <main className="page" style={{ paddingBottom: 'calc(var(--tabbar-h) + var(--safe-b) + 96px)' }}>
      {!chat?.id && <ReflectNav />}
      <div className="topbar">
        {chat?.id && <button className="icon-btn" onClick={() => { setChat(null); nav('/ask'); }} aria-label="Back to Ask"><Icon name="back" /></button>}
        <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat?.id ? chat.title : 'Ask'}</h1>
        <button className="icon-btn" onClick={() => setHistory(true)} aria-label="Chat history" title="History"><Icon name="history" /></button>
        {chat?.id && <button className="icon-btn" onClick={() => archive(!chat.archived)} aria-label={chat.archived ? 'Restore chat' : 'Archive chat'} title={chat.archived ? 'Restore' : 'Archive'}><Icon name="archive" /></button>}
        {(chat?.id || msgs.length > 0) && <button className="icon-btn" onClick={() => { setChat(null); nav('/ask'); }} aria-label="New chat" title="New chat"><Icon name="plus" /></button>}
      </div>
      {chat?.archived && <div className="banner info"><span className="grow">This chat is archived. Asking something new brings it back.</span></div>}

      {!msgs.length && <>
        <p className="muted" style={{ marginTop: 0 }}>Ask anything about your journal, your team, or how to handle what’s in front of you. Type @ to point at a person, meeting or note, add files or photos with +, or tap the mic to ask out loud.</p>
        <div className="stack" style={{ gap: 8 }}>
          {IDEAS.map(i => <button key={i} className="btn" style={{ justifyContent: 'flex-start', fontWeight: 500 }} onClick={() => send({ question: i })}>{i}</button>)}
        </div>
      </>}

      <div className="chat" onClick={onClick} aria-live="polite">
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="msg-user-wrap">
            {(m.refs?.length > 0 || m.attachments?.length > 0) && (
              <div className="msg-chips">
                {(m.refs || []).map(r => <Link key={`${r.type}-${r.id}`} to={LINK[r.type](r.id)} className="chip small-chip"><Icon name={REF_ICON[r.type]} size={13} /> {r.label}</Link>)}
                {(m.attachments || []).map(a => <span key={a.id} className="chip small-chip"><Icon name={a.kind === 'image' ? 'image' : 'clip'} size={13} /> <span className="chip-name">{a.name}</span></span>)}
              </div>
            )}
            <div className="msg-user">{m.content}</div>
          </div>
          : <div key={i} className="msg-ai md" dangerouslySetInnerHTML={{ __html: html(m) }} />)}
        {busy && <div className="row muted small"><span className="spinner" /> Looking through your journal…</div>}
        <div ref={end} />
      </div>

      <AskComposer busy={busy} placeholder={msgs.length ? 'Follow up…' : 'Ask, or type @ to mention…'} onSend={send} />

      <ChatHistory open={history} onClose={() => setHistory(false)} currentId={chat?.id} onOpen={id => { setHistory(false); nav(`/ask/${id}`); }}
        onDeleted={id => { if (id === chat?.id) { setChat(null); nav('/ask'); } }} />
    </main>
  );
}

function ChatHistory({ open, onClose, currentId, onOpen, onDeleted }) {
  const [archived, setArchived] = useState(false);
  const [list, setList] = useState(null);
  const load = () => api.get(`/chats?archived=${archived ? 1 : 0}`).then(setList).catch(() => setList([]));
  useEffect(() => { if (open) load(); }, [open, archived]);

  async function toggleArchive(c) { await api.patch(`/chats/${c.id}`, { archived: !archived }); load(); }
  async function remove(c) {
    if (!confirm(`Delete “${c.title}”? This can’t be undone.`)) return;
    await api.del(`/chats/${c.id}`); onDeleted(c.id); load();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Chats">
      <div className="seg mb">
        <button className={!archived ? 'on' : ''} onClick={() => setArchived(false)}>Recent</button>
        <button className={archived ? 'on' : ''} onClick={() => setArchived(true)}>Archived</button>
      </div>
      {list && list.length === 0 && <p className="muted small">{archived ? 'No archived chats.' : 'No chats yet.'}</p>}
      <div className="stack" style={{ gap: 6 }}>
        {(list || []).map(c => (
          <div key={c.id} className="row card" style={{ padding: '8px 10px', borderColor: c.id === currentId ? 'var(--accent)' : undefined }}>
            <button onClick={() => onOpen(c.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Untitled chat'}</div>
              <div className="small muted">{formatDate(c.updated_at, { time: true })} · {Math.ceil((c.count || 0) / 2)} question{Math.ceil((c.count || 0) / 2) === 1 ? '' : 's'}</div>
            </button>
            <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => toggleArchive(c)} aria-label={archived ? 'Restore' : 'Archive'} title={archived ? 'Restore' : 'Archive'}><Icon name={archived ? 'retry' : 'archive'} size={17} /></button>
            <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => remove(c)} aria-label="Delete" title="Delete"><Icon name="trash" size={17} /></button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

