import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import { VoiceTextarea } from '../components/VoiceInput.jsx';
import { formatDate } from '../lib/format.js';
import { useApp } from '../lib/context.js';

const AUDIENCES = [['direct_report', 'Someone on my team'], ['peer', 'A peer'], ['manager', 'My manager'], ['stakeholder', 'A stakeholder or partner'], ['team', 'My whole team']];
const CH = { email: 'Email', slack: 'Slack', text: 'Text' };
const KIND = { example: 'A message you sent', edited: 'A draft you edited' };

/** Your voice: writing exercises, messages you've sent, and the style profile Heartwood learns from them. */
export default function Voice() {
  const nav = useNavigate();
  const { notify } = useApp();
  const [v, setV] = useState(null);
  const [ex, setEx] = useState(null); // exercise being answered
  const [answer, setAnswer] = useState('');
  const [paste, setPaste] = useState(false);
  const [sample, setSample] = useState({ text: '', audience: 'direct_report', channel: 'email' });
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/voice').then(r => { setV(r); setOwn(r.profile?.own_words || ''); }).catch(e => notify(e.message));
  useEffect(() => { load(); }, []);
  // The profile refreshes in the background after new samples; check back shortly.
  useEffect(() => { if (!v?.refreshing) return; const t = setTimeout(load, 4000); return () => clearTimeout(t); }, [v?.refreshing]);
  if (!v) return <main className="page" />;

  async function saveExercise() {
    setBusy(true);
    try { const r = await api.post('/voice/samples', { kind: 'exercise', situation: ex.id, text: answer }); setV(r); setEx(null); notify('Saved. Heartwood is learning from it.'); setTimeout(load, 5000); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  async function saveSample() {
    setBusy(true);
    try { const r = await api.post('/voice/samples', { kind: 'example', ...sample }); setV(r); setPaste(false); setSample(s => ({ ...s, text: '' })); setTimeout(load, 5000); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  async function relearn() {
    setBusy(true);
    try { setV(await api.post('/voice/learn')); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  const saveOwn = () => own !== (v.profile?.own_words || '') && api.put('/voice/own-words', { text: own }).then(setV).catch(() => {});
  async function remove(s) { if (!confirm('Remove this sample?')) return; setV(await api.del(`/voice/samples/${s.id}`)); }

  const p = v.profile;
  const done = v.counts.exercise, total = v.exercises.length;
  const learnedFrom = done + v.counts.example + v.counts.edited;
  return (
    <main className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav('/you')} aria-label="Back to You"><Icon name="back" /></button>
        <h1>Your voice</h1>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>Heartwood learns how you write so the messages it drafts sound like you. It learns from short exercises, messages you’ve sent, and every draft you edit before using. Everything stays on your server.</p>

      <section className="card" aria-labelledby="profile-title">
        <div className="row" style={{ gap: 8 }}>
          <h2 id="profile-title" className="week-title grow">How you write</h2>
          {learnedFrom >= 2 && <button className="btn ghost small" onClick={relearn} disabled={busy || v.refreshing}>{v.refreshing || busy ? <><span className="spinner" /> Learning…</> : 'Refresh'}</button>}
        </div>
        {p?.summary ? <>
          <p style={{ margin: '6px 0 10px' }}>{p.summary}</p>
          {p.traits?.length > 0 && <ul className="voice-traits">{p.traits.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          {Object.keys(p.by_audience || {}).length > 0 && (
            <dl className="voice-aud">
              {AUDIENCES.filter(([k]) => p.by_audience[k]).map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{p.by_audience[k]}</dd></div>)}
            </dl>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>Learned from {p.sample_count} sample{p.sample_count === 1 ? '' : 's'}, {formatDate(p.at).toLowerCase()}. It refreshes on its own as you add more.{p.gaps ? ` ${p.gaps}` : ''}</p>
        </> : (
          <p className="muted" style={{ margin: '6px 0 0' }}>{learnedFrom ? 'One more sample and Heartwood can describe your style.' : 'Do two exercises below and Heartwood will describe your style here.'}</p>
        )}
        <label className="field" style={{ marginTop: 14, marginBottom: 0 }}><span>In your own words <small>(optional)</small></span>
          <textarea className="textarea" rows={2} value={own} onChange={e => setOwn(e.target.value)} onBlur={saveOwn}
            placeholder="e.g. I keep things short, never use exclamation marks, and always say thanks first." />
        </label>
      </section>

      <div className="section-head"><Icon name="note" size={20} /><h2>Writing exercises</h2><span className="small muted">{done} of {total}</span></div>
      <p className="small muted" style={{ marginTop: -4 }}>Write each one the way you really would. Different situations and audiences teach Heartwood how your voice shifts. Write or say it; a few sentences is plenty.</p>
      <div className="card" style={{ padding: '4px 16px' }}>
        {v.exercises.map(e => (
          <button key={e.id} type="button" className="voice-ex" onClick={() => { setEx(e); setAnswer(e.answer || ''); }}>
            <span className={`voice-ex-check${e.done ? ' on' : ''}`} aria-hidden="true">{e.done && <Icon name="check" size={13} />}</span>
            <span className="grow"><b>{e.title}</b><small>To {e.audience_label} · {CH[e.channel]}</small></span>
            <span className="small muted">{e.done ? 'Redo' : 'Start'}</span>
          </button>
        ))}
      </div>

      <div className="section-head"><Icon name="send" size={20} /><h2>Messages you’ve sent</h2>
        <button className="btn ghost small" onClick={() => setPaste(true)}><Icon name="plus" size={14} /> Add one</button>
      </div>
      <div className="card" style={{ padding: '6px 16px' }}>
        {v.samples.length === 0 && <p className="small muted">Paste a few real emails or Slack messages you’ve sent. Drafts you edit before copying are added here too, and teach Heartwood the most.</p>}
        {v.samples.slice(0, 20).map(s => (
          <div key={s.id} className="voice-sample">
            <div className="row" style={{ gap: 6 }}>
              <span className="small muted grow">{KIND[s.kind] || 'Sample'}{s.audience ? ` · to ${AUDIENCES.find(a => a[0] === s.audience)?.[1].toLowerCase()}` : ''}{s.channel ? ` · ${CH[s.channel]}` : ''} · {formatDate(s.at)}</span>
              <button type="button" className="chip-x" onClick={() => remove(s)} aria-label="Remove sample"><Icon name="x" size={13} /></button>
            </div>
            <p>{s.text}</p>
          </div>
        ))}
      </div>

      <Sheet open={!!ex} onClose={() => setEx(null)} title={ex?.title || ''}>
        {ex && <>
          <p className="small muted" style={{ marginTop: -8 }}>To {ex.audience_label} · {CH[ex.channel]}</p>
          <p className="voice-prompt">{ex.prompt}</p>
          <VoiceTextarea value={answer} onChange={setAnswer} rows={6} placeholder="Write it the way you really would." label="Your message" autoFocus />
          <p className="small muted">Make up the details; it’s how you say it that counts.</p>
          <button className="btn primary block" onClick={saveExercise} disabled={busy || answer.trim().length < 20}>{busy ? <span className="spinner" /> : 'Save'}</button>
        </>}
      </Sheet>
      <Sheet open={paste} onClose={() => setPaste(false)} title="Add a message you sent">
        <div className="field"><span>Who it was to</span>
          <div className="chips">{AUDIENCES.map(([k, l]) => <button key={k} type="button" className={`chip${sample.audience === k ? ' on' : ''}`} aria-pressed={sample.audience === k} onClick={() => setSample(s => ({ ...s, audience: k }))}>{l}</button>)}</div>
        </div>
        <div className="field"><span>Where</span>
          <div className="chips">{Object.entries(CH).map(([k, l]) => <button key={k} type="button" className={`chip${sample.channel === k ? ' on' : ''}`} aria-pressed={sample.channel === k} onClick={() => setSample(s => ({ ...s, channel: k }))}>{l}</button>)}</div>
        </div>
        <VoiceTextarea value={sample.text} onChange={t => setSample(s => ({ ...s, text: t }))} rows={6} placeholder="Paste the message. Take out anything private first." label="The message" />
        <button className="btn primary block mt" onClick={saveSample} disabled={busy || sample.text.trim().length < 20}>{busy ? <span className="spinner" /> : 'Add'}</button>
      </Sheet>
    </main>
  );
}
