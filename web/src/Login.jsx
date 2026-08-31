import { useState } from 'react';
import { api } from './api.js';

export function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      setPassword('');
      onSuccess();
    } catch (err) {
      setError(err.unauthorized ? 'Wrong password.' : err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Kanban</h1>
        <p>Enter your password to open the board.</p>
        <input
          className="input"
          type="password"
          value={password}
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={busy}>
          {busy ? 'Checking…' : 'Open board'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
