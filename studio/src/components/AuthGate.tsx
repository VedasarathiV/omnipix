import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, setToken, type AuthStatus } from '../lib/api';

/**
 * Auth gate: setup (first run) → login → app. Desktop installs sign in
 * silently over loopback; everyone else sees exactly one of these screens.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading, refetch } = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch('/api/auth/status'),
    retry: false,
  });

  useEffect(() => {
    const onUnauthorized = () => void refetch();
    window.addEventListener('omnipix:unauthorized', onUnauthorized);
    return () => window.removeEventListener('omnipix:unauthorized', onUnauthorized);
  }, [refetch]);

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center bg-base-0">
        <div className="flex size-14 animate-pulse items-center justify-center rounded-2xl bg-ok font-mono text-xl font-bold text-base-0">O</div>
      </div>
    );
  }
  if (data.authenticated) return <>{children}</>;
  if (data.needsSetup) return <Setup onDone={() => void refetch()} />;
  return <Login onDone={() => void refetch()} />;
}

function Shell({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-base-0 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-base-1 p-6">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-ok font-mono text-lg font-bold text-base-0">O</div>
        <h1 className="text-center text-base font-semibold">{title}</h1>
        <p className="mt-1 mb-4 text-center text-xs text-ink-dim">{body}</p>
        {children}
      </div>
    </div>
  );
}

function field(label: string, props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 text-sm outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
      />
    </label>
  );
}

function Setup({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Claim your dashboard" body="First run: create the local admin account.">
      <form onSubmit={submit}>
        {field('Email', { type: 'email', value: email, onChange: e => setEmail(e.target.value), required: true, autoComplete: 'email' })}
        {field('Password', { type: 'password', value: password, onChange: e => setPassword(e.target.value), required: true, autoComplete: 'new-password' })}
        {error && <p role="alert" className="mb-3 text-xs text-bad">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </Shell>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Welcome back" body="Sign in to your local OmniPix.">
      <form onSubmit={submit}>
        {field('Email', { type: 'email', value: email, onChange: e => setEmail(e.target.value), required: true, autoComplete: 'email' })}
        {field('Password', { type: 'password', value: password, onChange: e => setPassword(e.target.value), required: true, autoComplete: 'current-password' })}
        {error && <p role="alert" className="mb-3 text-xs text-bad">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Shell>
  );
}
