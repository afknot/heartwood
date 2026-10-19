import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { KINDS, duration } from '../lib/format.js';

export function StatusBadge({ status }) {
  if (status === 'transcribing') return <span className="status"><span className="pulse" /> Transcribing</span>;
  if (status === 'processing') return <span className="status"><span className="pulse" /> Reading files</span>;
  if (status === 'analyzing') return <span className="status"><span className="pulse" /> Reflecting</span>;
  if (status === 'error') return <span className="status error">Needs attention</span>;
  return null;
}

export default function EntryItem({ e }) {
  const time = new Date(e.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <Link to={`/entry/${e.id}`} className="entry-item">
      <h3>{e.title || (e.status === 'transcribing' ? 'New recording' : e.status === 'processing' ? 'Reading files…' : 'Untitled')}</h3>
      {e.preview && <p>{e.preview}</p>}
      <div className="entry-meta">
        {e.file_count ? <Icon name="clip" size={14} /> : e.has_audio || e.audio_seconds ? <Icon name="wave" size={14} /> : <Icon name="note" size={14} />}
        <span>{KINDS[e.kind]}</span>
        <span className="dot">{time}</span>
        {e.audio_seconds ? <span className="dot">{duration(e.audio_seconds)}</span> : null}
        {e.people?.length > 0 && <span className="dot">{e.people.map(p => p.name.split(' ')[0]).join(', ')}</span>}
        <StatusBadge status={e.status} />
      </div>
    </Link>
  );
}
