import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu, GripVertical, KeyRound, X } from 'lucide-react';
import { useKeylessAvailable, useKeys, useModels, useOllama } from '../lib/queries';
import { ProviderIcon } from '../components/ProviderIcon';
import { apiFetch } from '../lib/api';
import { useStudio } from '../state/store';
import { EmptyState } from '../components/EmptyState';

function titleCase(platform: string): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function ProvidersPage() {
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const { data: keys = [], isLoading: keysLoading } = useKeys();
  const { data: models = [], isLoading: modelsLoading } = useModels();
  const [order, setOrder] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const { data: keylessData } = useKeylessAvailable();
  const keyless = keylessData?.providers ?? [];

  async function enableAllKeyless() {
    try {
      const out = await apiFetch<{ enabled: string[] }>('/api/keys/keyless-available/enable', { method: 'POST' });
      pushToast('ok', out.enabled.length ? `Enabled ${out.enabled.length} free provider${out.enabled.length === 1 ? '' : 's'} — no keys needed.` : 'Nothing new to enable.');
      void queryClient.invalidateQueries({ queryKey: ['keys'] });
      void queryClient.invalidateQueries({ queryKey: ['keyless-available'] });
      void queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Enable failed');
    }
  }

  async function dismissKeyless() {
    try {
      await apiFetch('/api/keys/keyless-available/dismiss', { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: ['keyless-available'] });
    } catch {
      // Dismiss is a courtesy; a failure just leaves the notice up.
    }
  }

  async function testKey(keyId: number, platform: string) {
    try {
      const res = await apiFetch<{ healthy?: boolean; ok?: boolean; error?: string }>(`/api/health/check/${keyId}`, { method: 'POST' });
      const healthy = res.healthy ?? res.ok ?? false;
      pushToast(healthy ? 'ok' : 'error', healthy ? `${platform} key healthy` : `${platform}: ${res.error ?? 'unhealthy'}`);
      void queryClient.invalidateQueries({ queryKey: ['keys'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Health check failed');
    }
  }

  const platforms = [...new Set(models.map(m => m.platform))].sort();
  const ids = order ?? platforms;
  const keysByPlatform = new Map<string, typeof keys>();
  for (const key of keys) {
    const list = keysByPlatform.get(key.platform) ?? [];
    list.push(key);
    keysByPlatform.set(key.platform, list);
  }
  const configured = platforms.filter(p => (keysByPlatform.get(p) ?? []).some(k => k.enabled)).length;

  function move(id: string, dir: -1 | 1) {
    const base = order ?? platforms;
    const i = base.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= base.length) return;
    const next = [...base];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  if (keysLoading || modelsLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-4">
        <h1 className="mb-4 text-lg font-semibold">Provider keys</h1>
        <p className="animate-pulse text-sm text-ink-dim">Loading providers…</p>
      </div>
    );
  }

  if (!platforms.length) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-4">
        <h1 className="mb-4 text-lg font-semibold">Provider keys</h1>
        <EmptyState
          icon={<KeyRound className="size-5" strokeWidth={1.5} />}
          title="No providers in the catalog"
          body="Sync the model catalog or add a custom endpoint to get started."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Provider keys</h1>
        <span className="font-mono text-xs text-ink-dim">{configured} of {platforms.length} configured</span>
      </div>
      <OllamaCard />
      {keyless.length > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-base-1 px-4 py-3">
          <KeyRound className="size-4 shrink-0 text-ok" strokeWidth={1.5} />
          <p className="min-w-0 flex-1 text-[13px]">
            {keyless.length} free provider{keyless.length === 1 ? '' : 's'} need{keyless.length === 1 ? 's' : ''} no key:{' '}
            <span className="text-ink-dim">{keyless.map(k => k.name).join(', ')}</span>
          </p>
          <button
            type="button"
            onClick={() => void enableAllKeyless()}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            Enable all
          </button>
          <button
            type="button"
            onClick={() => void dismissKeyless()}
            title="Dismiss"
            aria-label="Dismiss free providers"
            className="shrink-0 rounded-md p-1.5 text-ink-faint outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {ids.map(id => {
          const platformModels = models.filter(m => m.platform === id);
          const platformKeys = keysByPlatform.get(id) ?? [];
          const healthy = platformKeys.some(k => k.enabled && k.status !== 'invalid');
          const hasKey = platformKeys.some(k => k.enabled);
          const freeTier = platformModels.some(m => m.monthlyTokenBudget);
          return (
            <article
              key={id}
              draggable
              onDragStart={() => setDrag(id)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (!drag || drag === id) return;
                const base = order ?? platforms;
                const without = base.filter(x => x !== drag);
                const at = without.indexOf(id);
                without.splice(at, 0, drag);
                setOrder(without);
                setDrag(null);
              }}
              className="rounded-xl border border-line bg-base-1 p-4"
            >
              <div className="flex items-center gap-2">
                <GripVertical className="size-4 cursor-grab text-ink-faint" strokeWidth={1.5} />
                <span className={`size-2 rounded-full ${healthy ? 'bg-ok' : hasKey ? 'bg-bad' : 'bg-ink-faint'}`} />
                <ProviderIcon platform={id} />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{titleCase(id)}</p>
                {freeTier && <span className="shrink-0 rounded-md bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">FREE TIER</span>}
                <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-ink-dim">{platformModels.length} models</span>
              </div>
              <div className="mt-3 flex gap-1.5">
                {!hasKey ? (
                  <button
                    type="button"
                    onClick={() => setAdding(id)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <KeyRound className="size-3.5" strokeWidth={1.5} /> Add key
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { const first = platformKeys.find(k => k.enabled); if (first) void testKey(first.id, titleCase(id)); }}
                      className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Test key
                    </button>
                    <button type="button" title="Move up in fallback order" aria-label={`Move ${id} up`} onClick={() => move(id, -1)} className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">↑</button>
                    <button type="button" title="Move down in fallback order" aria-label={`Move ${id} down`} onClick={() => move(id, 1)} className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">↓</button>
                  </>
                )}
              </div>
              {platformKeys.filter(k => k.last_health_error).slice(0, 1).map(k => (
                <p key={k.id} className="mt-2 truncate font-mono text-[11px] text-bad">{k.last_health_error}</p>
              ))}
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-dim">Drag cards (or use ↑ ↓) to set the Auto fallback order.</p>
      {adding && <AddKeyDialog platform={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function OllamaCard() {
  const { data, isLoading } = useOllama();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [pull, setPull] = useState('');
  const [busy, setBusy] = useState<'connect' | 'pull' | null>(null);
  const ollama = data?.ollama;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['ollama'] });
    void queryClient.invalidateQueries({ queryKey: ['keys'] });
    void queryClient.invalidateQueries({ queryKey: ['models'] });
  }

  async function connect() {
    setBusy('connect');
    try {
      const res = await apiFetch<{ models: string[]; created: string[] }>('/api/local/ollama/connect', { method: 'POST' });
      pushToast('ok', res.created.length ? `Connected — registered ${res.created.join(', ')}` : `Connected — ${res.models.length} model(s) already registered`);
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setBusy(null);
    }
  }

  async function pullModel(e: React.FormEvent) {
    e.preventDefault();
    if (!pull.trim()) return;
    setBusy('pull');
    try {
      await apiFetch('/api/local/ollama/pull', { method: 'POST', body: JSON.stringify({ model: pull.trim() }) });
      pushToast('ok', `Pulled ${pull.trim()}`);
      setPull('');
      refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Pull failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-xl border border-line bg-base-1 p-4">
      <div className="flex items-center gap-2">
        <Cpu className="size-4 text-ink-dim" strokeWidth={1.5} />
        <span className={`size-2 rounded-full ${isLoading ? 'animate-pulse bg-ink-faint' : ollama?.running ? 'bg-ok' : 'bg-bad'}`} />
        <p className="text-sm font-semibold">Local Ollama</p>
        <span className="rounded-md bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">FREE · NO KEY</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-ink-dim">
          {isLoading ? 'probing…' : ollama?.running ? `v${ollama.version ?? '?'} · ${ollama.models.length} pulled · ${ollama.registeredModels.length} registered` : 'not running'}
        </span>
      </div>
      {!isLoading && ollama && (
        <p className="mt-2 font-mono text-[11px] text-ink-dim">
          {ollama.running
            ? ollama.models.length
              ? `On this laptop: ${ollama.models.map(m => m.name).join(', ')}`
              : 'Daemon is up but no models are pulled yet.'
            : 'Start Ollama (`ollama serve` or the Ollama app), then connect. Models run on your laptop — no API key, no cost.'}
        </p>
      )}
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy !== null || isLoading}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy === 'connect' ? 'Connecting…' : ollama?.connected ? 'Reconnect (pick up new models)' : 'Connect local Ollama'}
        </button>
        <form onSubmit={e => void pullModel(e)} className="flex flex-1 gap-1.5">
          <input
            value={pull}
            onChange={e => setPull(e.target.value)}
            placeholder="Pull a model: qwen2.5-coder:7b"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-line bg-base-0 px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button
            type="submit"
            disabled={busy !== null || !pull.trim()}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {busy === 'pull' ? 'Pulling…' : 'Pull'}
          </button>
        </form>
      </div>
    </article>
  );
}

function AddKeyDialog({ platform, onClose }: { platform: string; onClose: () => void }) {
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ platform, key, label: label.trim() || undefined }),
      });
      pushToast('ok', `${platform} key added`);
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['keys'] });
      void queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={e => void submit(e)}
        className="w-full max-w-sm rounded-xl border border-line bg-base-1 p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add {platform} key</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">API key</span>
          <input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium">Label <span className="font-normal text-ink-faint">(optional)</span></span>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="personal"
            className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add key'}
        </button>
      </form>
    </div>
  );
}
