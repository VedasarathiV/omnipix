import {
  siAnthropic,
  siCloudflare,
  siDeepseek,
  siGoogle,
  siHuggingface,
  siMeta,
  siMistralai,
  siNvidia,
  siOllama,
  siOpencode,
  siOpenrouter,
  siOvh,
} from 'simple-icons';

// Brand mark per provider. simple-icons covers the big names; everything else
// gets a deterministic letter tile so unknown providers still look designed.
const BRANDS: Record<string, { path: string; hex: string }> = {
  google: siGoogle,
  cloudflare: siCloudflare,
  huggingface: siHuggingface,
  nvidia: siNvidia,
  deepseek: siDeepseek,
  openrouter: siOpenrouter,
  ollama: siOllama,
  opencode: siOpencode,
  ovh: siOvh,
  mistral: siMistralai,
  anthropic: siAnthropic,
  meta: siMeta,
};

function hueFor(platform: string): number {
  let hash = 0;
  for (const ch of platform) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function ProviderIcon({ platform, size = 18 }: { platform: string; size?: number }) {
  const brand = BRANDS[platform.toLowerCase()];
  if (brand) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-md bg-base-2 p-1"
        style={{ width: size + 8, height: size + 8 }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="text-ink">
          <path d={brand.path} />
        </svg>
      </span>
    );
  }
  const letter = (platform.charAt(0) || '?').toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
      style={{
        width: size + 8,
        height: size + 8,
        backgroundColor: `hsl(${hueFor(platform)} 45% 28%)`,
        color: `hsl(${hueFor(platform)} 80% 78%)`,
      }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
