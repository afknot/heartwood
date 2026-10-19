import { useEffect, useState, useCallback, useRef } from 'react';
import { AskButton } from '../components/AskButton.jsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import EntryItem from '../components/EntryItem.jsx';
import { KINDS, dayKey } from '../lib/format.js';
import { listPending, flushPending, removePending } from '../lib/pending.js';
import { useApp } from '../lib/context.js';
import Sheet from '../components/Sheet.jsx';

export default function Journal() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { people, notify } = useApp();
  const [entries, setEntries] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [person, setPerson] = useState('');
  const [tags, setTags] = useState([]);
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState([]);
  const [adding, setAdding] = useState(false);
  const timer = useRef();

  const query = useCallback((before) => {
    const p = new URLSearchParams({ limit: '40' });
    if (q.trim()) p.set('q', q.trim());
    if (kind) p.set('kind', kind);
    if (tag) p.set('tag', tag);
    if (person) p.set('person', person);
    if (before) p.set('before', before);
    return api.get(`/entries?${p}`);
  }, [q, kind, tag, person]);

  const load = useCallback(() => query().then(r => { setEntries(r); setMore(r.length === 40 && !q.trim()); }).catch(e => notify(e.message)), [query, q, notify]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { api.get('/entries/tags').then(r => setTags(r.map(x => x.tag))).catch(() => {}); }, []);
  useEffect(() => { listPending().then(l => setPending(l.filter(p => !p.draft))).catch(() => {}); }, []);
  // Old "Follow-up update" notes can move out of the journal, onto the people they're about.
  const [updates, setUpdates] = useState(0);
  useEffect(() => { api.get('/context/move-updates').then(r => setUpdates(r.count || 0)).catch(() => {}); }, []);
  async function moveUpdates() {
    if (!confirm(`Move ${updates} update note${updates === 1 ? '' : 's'} out of your journal? Each becomes context on the people it’s about, where Ask and prep still use it. Notes with files stay in your journal.`)) return;
    const r = await api.post('/context/move-updates');
    setUpdates(0); notify(`Moved ${r.moved} update${r.moved === 1 ? '' : 's'} to the people they’re about`); load();
  }

  // Keep busy entries fresh
  useEffect(() => {
    clearInterval(timer.current);
    if (entries?.some(e => ['transcribing', 'analyzing', 'processing'].includes(e.status))) timer.current = setInterval(load, 4000);
    return () => clearInterval(timer.current);
  }, [entries, load]);

  // "New note" shortcut from the home screen icon
  useEffect(() => {
    if (params.get('new')) { setParams({}, { replace: true }); newNote(); }
  }, []);

  async function newNote() {
    const e = await api.post('/entries', { kind: 'note' });
    nav(`/entry/${e.id}?fresh=1`);
  }

  async function retryPending() {
    const n = await flushPending();
    setPending((await listPending()).filter(p => !p.draft));
    if (n) { notify(`Uploaded ${n}`); load(); }
  }

  async function loadMore() {
    const r = await query(entries.at(-1)?.created_at);
    setEntries([...entries, ...r]);
    setMore(r.length === 40);
  }

  const groups = [];
  for (const e of entries || []) {
    const k = dayKey(e.created_at);
    if (groups.at(-1)?.k !== k) groups.push({ k, items: [] });
    groups.at(-1).items.push(e);
  }
  const filtering = q || kind || tag || person;

  return (
    <main className="page">
      <div className="topbar">
        <h1>Journal</h1>
        <AskButton />
        <button className="icon-btn" onClick={() => setAdding(true)} aria-label="Add"><Icon name="plus" /></button>
      </div>

      <div className="search"><Icon name="search" size={18} />
        <input type="search" placeholder="Search notes and transcripts" value={q} onChange={e => setQ(e.target.value)} />
        {q && <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setQ('')} aria-label="Clear"><Icon name="x" size={16} /></button>}
      </div>

      <div className="scroll-x mt" style={{ marginTop: 10 }}>
        {Object.entries(KINDS).map(([k, label]) => (
          <button key={k} aria-pressed={kind === k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>{label}</button>
        ))}
        {people.filter(p => p.entry_count > 0).slice(0, 12).map(p => (
          <button key={p.id} aria-pressed={person === p.id} className={`chip${person === p.id ? ' on' : ''}`} onClick={() => setPerson(person === p.id ? '' : p.id)}>{p.name.split(' ')[0]}</button>
        ))}
        {tags.slice(0, 20).map(t => (
          <button key={t} aria-pressed={tag === t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>#{t}</button>
        ))}
      </div>

      {updates > 0 && (
        <div className="banner mt">
          <span className="grow small">{updates} note{updates === 1 ? ' is a' : 's are'} just follow-up updates. Move {updates === 1 ? 'it' : 'them'} to the people {updates === 1 ? 'it’s' : 'they’re'} about, to keep your journal for real entries?</span>
          <button className="btn small" onClick={moveUpdates}>Move</button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="banner warn mt">
          <span className="grow">{pending.length} recording{pending.length > 1 ? 's' : ''} saved on this phone, waiting to upload.
            {pending.some(p => p.error) && <><br /><small>{pending.find(p => p.error).error}</small></>}
          </span>
          <button className="btn small" onClick={retryPending}>Retry</button>
          {pending.some(p => p.error) && <button className="btn small danger" onClick={async () => {
            if (!confirm('Delete the recordings that failed to upload? This cannot be undone.')) return;
            for (const p of pending.filter(p => p.error)) await removePending(p.id);
            setPending((await listPending()).filter(p => !p.draft));
          }}>Discard</button>}
        </div>
      )}

      {entries && entries.length === 0 && (
        <div className="empty">
          {filtering ? <p>Nothing matches.</p> : <>
            <h2>Your journal starts here</h2>
            <p>Record a voice memo or a conversation, or write a note. Heartwood transcribes it, files it, and helps you reflect.</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              <Link to="/record" className="btn rec"><Icon name="mic" size={18} /> Record</Link>
              <button className="btn" onClick={newNote}><Icon name="note" size={18} /> Write</button>
            </div>
          </>}
        </div>
      )}

      {groups.map(g => (
        <section key={g.k}>
          <h2 className="day-label">{g.k}</h2>
          {g.items.map(e => <EntryItem key={e.id} e={e} />)}
        </section>
      ))}
      {more && <button className="btn block mt" onClick={loadMore}>Load older entries</button>}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add to your journal">
        <div className="stack" style={{ gap: 8 }}>
          <button className="kind-opt" onClick={() => { setAdding(false); newNote(); }}>
            <Icon name="note" /> <span><b>Note</b><br /><span className="small muted">Write something new</span></span>
          </button>
          <button className="kind-opt" onClick={() => { setAdding(false); nav('/record'); }}>
            <Icon name="mic" /> <span><b>Recording</b><br /><span className="small muted">Voice memo, 1:1 or meeting</span></span>
          </button>
          <button className="kind-opt" onClick={() => { setAdding(false); nav('/add'); }}>
            <Icon name="clip" /> <span><b>Note from files</b><br /><span className="small muted">Docs, decks, spreadsheets or photos of notes</span></span>
          </button>
        </div>
      </Sheet>
    </main>
  );
}
