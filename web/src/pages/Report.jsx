import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { formatDate, renderMarkdown } from '../lib/format.js';

export default function Report() {
  const { id } = useParams();
  const nav = useNavigate();
  const [r, setR] = useState(null);
  useEffect(() => { api.get(`/reports/${id}`).then(setR).catch(() => nav('/insights')); }, [id, nav]);

  async function remove() {
    if (!confirm('Delete this debrief?')) return;
    await api.del(`/reports/${id}`);
    nav('/insights', { replace: true });
  }

  if (!r) return <main className="page" />;
  return (
    <main className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav('/insights')} aria-label="Back"><Icon name="back" /></button>
        <span className="spacer" />
        <button className="icon-btn" onClick={remove} aria-label="Delete"><Icon name="trash" /></button>
      </div>
      <h1 style={{ font: '650 26px/1.2 var(--serif)', margin: '0 0 4px' }}>{r.focus || 'Debrief'}</h1>
      <p className="small muted" style={{ marginTop: 0 }}>{r.range_from} → {r.range_to} · {r.entry_count} entries · written {formatDate(r.created_at, { time: true })}</p>
      <article className="md mt" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.content_md) }} />
    </main>
  );
}
