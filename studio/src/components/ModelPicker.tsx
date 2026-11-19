import { useModels } from '../lib/queries';
import { useStudio } from '../state/store';

/** Live model picker: Auto plus every enabled catalog model. */
export function ModelPicker({ compact }: { compact?: boolean }) {
  const { model, setModel } = useStudio();
  const { data: models = [] } = useModels();
  const enabled = models.filter(m => m.enabled);
  return (
    <select
      aria-label="Model"
      title="Model (⌘M)"
      value={model}
      onChange={e => setModel(e.target.value)}
      className={
        compact
          ? 'max-w-44 truncate rounded-md bg-transparent px-1 py-1 text-xs text-ink-dim outline-none focus-visible:ring-2 focus-visible:ring-accent'
          : 'max-w-56 truncate rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent'
      }
    >
      <option value="auto">Auto (fallback chain)</option>
      {enabled.map(m => (
        <option key={m.id} value={m.modelId}>
          {m.modelId} · {m.platform}
        </option>
      ))}
    </select>
  );
}
