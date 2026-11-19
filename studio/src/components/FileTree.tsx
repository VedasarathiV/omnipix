import { useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Search } from 'lucide-react';
import { FILES } from '../mock/data';
import type { FileNode } from '../types';
import { useStudio } from '../state/store';

const STATUS_STYLE: Record<string, string> = {
  M: 'text-warn',
  A: 'text-ok',
  D: 'text-bad',
  U: 'text-info',
};

export function FileTree() {
  const [query, setQuery] = useState('');
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-2">
        <div className="flex items-center gap-1.5 rounded-lg bg-base-0 px-2 py-1.5">
          <Search className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search files"
            aria-label="Search files"
            className="w-full bg-transparent text-xs outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <TreeNode node={FILES} depth={0} query={query.toLowerCase()} />
      </div>
    </div>
  );
}

function matches(node: FileNode, query: string): boolean {
  if (!query) return true;
  if (node.name.toLowerCase().includes(query)) return true;
  return (node.children ?? []).some(c => matches(c, query));
}

function TreeNode({ node, depth, query }: { node: FileNode; depth: number; query: string }) {
  const [open, setOpen] = useState(depth < 2);
  const { pushToast, setRightTab, setRightOpen } = useStudio();
  if (!matches(node, query)) return null;
  const expanded = open || query.length > 0;

  if (node.kind === 'file') {
    return (
      <button
        type="button"
        onClick={() => { setRightTab('files'); setRightOpen(true); pushToast('info', `Opened ${node.path}`); }}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <File className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
        {node.status && <span className={`shrink-0 font-mono text-[10px] font-bold ${STATUS_STYLE[node.status]}`}>{node.status}</span>}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={expanded}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
      >
        {expanded
          ? <ChevronDown className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
          : <ChevronRight className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />}
        {expanded
          ? <FolderOpen className="size-3.5 shrink-0 text-ink-dim" strokeWidth={1.5} />
          : <Folder className="size-3.5 shrink-0 text-ink-dim" strokeWidth={1.5} />}
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
      </button>
      {expanded && (node.children ?? []).map(child => <TreeNode key={child.path} node={child} depth={depth + 1} query={query} />)}
    </div>
  );
}
