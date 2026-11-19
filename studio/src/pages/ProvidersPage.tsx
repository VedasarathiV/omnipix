import { useState } from 'react';
import { GripVertical, KeyRound, Plus } from 'lucide-react';
import { PROVIDERS } from '../mock/data';
import { useStudio } from '../state/store';

export function ProvidersPage() {
  const { pushToast, hasKeys, setHasKeys } = useStudio();
  const [order, setOrder] = useState(PROVIDERS.map(p => p.id));
  const [drag, setDrag] = useState<string | null>(null);
  const configured = PROVIDERS.filter(p => p.status !== 'none').length;

  function move(id: string, dir: -1 | 1) {
    setOrder(list => {
      const i = list.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Provider keys</h1>
        <span className="font-mono text-xs text-ink-dim">{configured} of {PROVIDERS.length} configured</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => pushToast('ok', 'Key added — reordering fallback chain')}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="size-3.5" strokeWidth={1.5} /> Add key
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {order.map(id => {
          const p = PROVIDERS.find(x => x.id === id)!;
          return (
            <article
              key={p.id}
              draggable
              onDragStart={() => setDrag(p.id)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (!drag || drag === p.id) return;
                setOrder(list => {
                  const without = list.filter(x => x !== drag);
                  const at = without.indexOf(p.id);
                  without.splice(at, 0, drag);
                  return without;
                });
                setDrag(null);
              }}
              className="rounded-xl border border-line bg-base-1 p-4"
            >
              <div className="flex items-center gap-2">
                <GripVertical className="size-4 cursor-grab text-ink-faint" strokeWidth={1.5} />
                <span className={`size-2 rounded-full ${p.status === 'ok' ? 'bg-ok' : p.status === 'down' ? 'bg-bad' : 'bg-ink-faint'}`} />
                <p className="text-sm font-semibold">{p.name}</p>
                {p.freeTier && <span className="rounded-md bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">FREE TIER</span>}
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-ink-dim">{p.models} models{p.latencyMs ? ` · ${p.latencyMs}ms` : ''}</span>
              </div>
              <div className="mt-3 flex gap-1.5">
                {p.status === 'none' ? (
                  <button type="button" onClick={() => pushToast('ok', `Add ${p.name} key`)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">
                    <KeyRound className="size-3.5" strokeWidth={1.5} /> Add key
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => pushToast('ok', `${p.name} key healthy`)} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Test key</button>
                    <button type="button" title="Move up in fallback order" aria-label={`Move ${p.name} up`} onClick={() => move(p.id, -1)} className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">↑</button>
                    <button type="button" title="Move down in fallback order" aria-label={`Move ${p.name} down`} onClick={() => move(p.id, 1)} className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">↓</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-dim">Drag cards (or use ↑ ↓) to set the Auto fallback order.</p>
      <button
        type="button"
        onClick={() => setHasKeys(!hasKeys)}
        className="mt-1 text-xs text-ink-faint underline outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      >
        {hasKeys ? 'Preview: no-keys state' : 'Preview: keys configured'}
      </button>
    </div>
  );
}
