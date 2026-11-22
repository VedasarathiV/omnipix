import { isValidElement, memo, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { highlightCode } from '../lib/highlight';

// Assistant reply rendering: GitHub-flavored markdown, highlighted code
// blocks with hover copy buttons, safe links. Plain user turns stay pre-wrap.
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

function CodeBlock({ code, language, className }: { code: string; language?: string | null; className?: string }) {
  const { html, language: applied } = useMemo(() => highlightCode(code, language), [code, language]);
  return (
    <code
      className={`code-highlight block font-mono text-[12.5px] leading-relaxed whitespace-pre ${className ?? ''}`}
      data-language={applied ?? undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Pre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(nodeText(children).replace(/\n$/, ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  }
  return (
    <pre className="group relative my-2 overflow-x-auto rounded-lg border border-line bg-base-0 p-3 first:mt-0 last:mb-0">
      <button
        type="button"
        title="Copy code"
        aria-label="Copy code"
        onClick={() => void copy()}
        className="absolute top-2 right-2 rounded-md p-1.5 text-ink-faint opacity-0 outline-none transition-opacity group-hover:opacity-100 hover:bg-base-2 hover:text-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent"
      >
        {copied ? <Check className="size-3.5 text-ok" strokeWidth={1.5} /> : <Copy className="size-3.5" strokeWidth={1.5} />}
      </button>
      {children}
    </pre>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0 [overflow-wrap:anywhere]">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2 [overflow-wrap:anywhere]">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mt-4 mb-2 text-base font-semibold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-sm font-semibold tracking-tight first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 first:mt-0 last:mb-0 [&_ol]:my-1 [&_ul]:my-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0 [&_ol]:my-1 [&_ul]:my-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent/40 pl-3 text-ink-dim italic first:mt-0 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-line" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="opacity-70">{children}</del>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-base-2/60">{children}</thead>,
  th: ({ children }) => <th className="border border-line px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className ?? '');
    if (isBlock) {
      const language = /language-([^\s]+)/.exec(className ?? '')?.[1] ?? null;
      return <CodeBlock code={nodeText(children).replace(/\n$/, '')} language={language} className={className} />;
    }
    return (
      <code className="rounded bg-base-2 px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <Pre>{children}</Pre>,
};

function MarkdownInner({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`text-sm leading-relaxed ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
