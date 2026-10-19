import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';

export default function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState(false);

  useEffect(() => {
    if (!window.PublicKeyCredential) return;
    api.get('/auth/passkey/available').then(r => setPasskeys(!!r.available)).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api.post('/auth/login', { password: pw }); onDone(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }

  async function withPasskey() {
    setBusy(true); setErr('');
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optionsJSON = await api.post('/auth/passkey/login/options');
      const response = await startAuthentication({ optionsJSON });
      await api.post('/auth/passkey/login/verify', { response });
      onDone();
    } catch (x) {
      if (x?.name !== 'NotAllowedError') setErr(x.message || 'Passkey sign-in failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <img src="/icons/icon-192.png" alt="" />
        <h1>Heartwood</h1>
        <p className="muted mb">Your private leadership journal.</p>
        {passkeys && <>
          <button type="button" className="btn primary block" onClick={withPasskey} disabled={busy}><Icon name="key" size={18} /> Sign in with passkey</button>
          <p className="small muted" style={{ margin: '14px 0' }}>or use your password</p>
        </>}
        <input className="input" type="password" autoComplete="current-password" placeholder="Password" aria-label="Password"
          value={pw} onChange={e => setPw(e.target.value)} autoFocus={!passkeys} />
        {err && <p className="small" role="alert" style={{ color: 'var(--rec-text)' }}>{err}</p>}
        <button className={`btn block mt ${passkeys ? '' : 'primary'}`} disabled={!pw || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted mt-l">An <a href="https://afk.consulting" target="_blank" rel="noopener">AFK Consulting</a> tool · <a href="https://github.com/afknot/heartwood" target="_blank" rel="noopener">Source code</a></p>
      </form>
    </div>
  );
}
