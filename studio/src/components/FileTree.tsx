import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Search } from 'lucide-react';
import { useStudio } from '../state/store';
import { useFolderFiles, useRunDiff, useRunFiles } from '../lib/queries';

const STATUS_STYLE: Record<string, string> = {
  M: 'text-warn',
  A: 'text-ok',
  D: 'text-bad',
  U: 'text-info',
};

interface Node {
  name: string;
  path: string;
  dir: boolean;
  children: Map<string, Node>;
}

function buildTree(paths: string[]): Node {
  const root: Node = { name: '', path: '', dir: true, children: new Map() };
  for (const full of paths.sort()) {
    const parts = full.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const isDir = i < parts.length - 1;
      const childPath = parts.slice(0, i + 1).join('/');
      let child = node.children.get(parts[i]);
      if (!child) {
        child = { name: parts[i], path: childPath, dir: isDir, children: new Map() };
        node.children.set(parts[i], child);
      }
      node = child;
    }
  }
  return root;
}

export function FileTree() {
  const { activeRunId, setAgentEditor, fileRoot, setFileRoot, setSelectedFile, setRightTab, setRightOpen } = useStudio();
  const [query, setQuery] = useState('');
  const [folderMode, setFolderMode] = useState(activeRunId === null);
  const [draftRoot, setDraftRoot] = useState(fileRoot ?? '');
  const { data: filesData } = useRunFiles(activeRunId);
  const { data: diff } = useRunDiff(activeRunId, null);
  const { data: folderData, error: folderError } = useFolderFiles(folderMode ? (fileRoot || null) : null);

  function openRunFile(path: string) {
    setFileRoot(null);
    setSelectedFile(path);
    setRightTab('files');
    setRightOpen(true);
  }

  function openFolderFile(path: string) {
    setSelectedFile(path);
    setRightTab('files');
    setRightOpen(true);
  }

  function openRoot() {
    const trimmed = draftRoot.trim();
    if (!trimmed) return;
    setFileRoot(trimmed);
    setSelectedFile(null);
  }

  const switcher = activeRunId !== null ? (
    <div className="flex gap-1 border-b border-line p-2" role="tablist" aria-label="File source">
      <button
        type="button"
        role="tab"
        aria-selected={!folderMode}
        onClick={() => setFolderMode(false)}
        className={`flex-1 rounded-md px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent ${!folderMode ? 'bg-base-2 font-medium' : 'text-ink-dim hover:text-ink'}`}
      >
        Run workspace
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={folderMode}
        onClick={() => setFolderMode(true)}
        className={`flex-1 rounded-md px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent ${folderMode ? 'bg-base-2 font-medium' : 'text-ink-dim hover:text-ink'}`}
      >
        Folder
      </button>
    </div>
  ) : null;

  if (!folderMode) {
    if (activeRunId === null) {
      return (
        <div className="px-3 py-6 text-center">
          <p className="text-xs text-ink-faint">Start an agent run to browse its workspace.</p>
          <button
            type="button"
            onClick={() => setAgentEditor('new')}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            New run
          </button>
        </div>
      );
    }
    const entries = filesData?.files ?? [];
    const statusByPath = new Map((diff?.files ?? []).map(f => [f.path, f.status]));
    const root = buildTree(entries.map(e => e.path));
    return (
      <div className="flex h-full flex-col">
        {switcher}
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
          {entries.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-ink-faint">Workspace is empty.</p>
          )}
          {[...root.children.values()].map(child => (
            <TreeNode key={child.path} node={child} depth={0} query={query.toLowerCase()} statusByPath={statusByPath} onOpen={openRunFile} />
          ))}
        </div>
      </div>
    );
  }

  const folderEntries = folderData?.entries ?? [];
  const folderRoot = buildTree(folderEntries.map(e => e.path));
  return (
    <div className="flex h-full flex-col">
      {switcher}
      <div className="border-b border-line p-2">
        <div className="flex items-center gap-1.5 rounded-lg bg-base-0 px-2 py-1.5">
          <FolderOpen className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
          <input
            value={draftRoot}
            onChange={e => setDraftRoot(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') openRoot(); }}
            placeholder="/absolute/path/to/project"
            aria-label="Folder root"
            spellCheck={false}
            autoComplete="off"
            className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={openRoot}
            className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
          >
            Open
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-base-0 px-2 py-1.5">
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
        {!fileRoot && (
          <p className="px-2 py-4 text-center text-xs text-ink-faint">Enter an absolute folder path above to browse real source.</p>
        )}
        {fileRoot && folderError && (
          <p className="px-2 py-4 text-center text-xs text-bad">Cannot open folder — check the path and try again.</p>
        )}
        {fileRoot && !folderError && folderEntries.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-ink-faint">Folder is empty.</p>
        )}
        {[...folderRoot.children.values()].map(child => (
          <TreeNode key={child.path} node={child} depth={0} query={query.toLowerCase()} statusByPath={EMPTY_STATUS} onOpen={openFolderFile} />
        ))}
      </div>
    </div>
  );
}

const EMPTY_STATUS = new Map<string, string>();

function matches(node: Node, query: string): boolean {
  if (!query) return true;
  if (node.name.toLowerCase().includes(query)) return true;
  return [...node.children.values()].some(c => matches(c, query));
}

function TreeNode({ node, depth, query, statusByPath, onOpen }: {
  node: Node;
  depth: number;
  query: string;
  statusByPath: Map<string, string>;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [forceShut, setForceShut] = useState(false);
  useEffect(() => {
    if (!query) setForceShut(false);
  }, [query]);
  if (!matches(node, query)) return null;
  // Filtering auto-expands matches, but an explicit chevron click wins;
  // clearing the filter restores the manual open state.
  const expanded = query.length > 0 ? !forceShut : open;
  const status = statusByPath.get(node.path);

  if (!node.dir) {
    return (
      <button
        type="button"
        onClick={() => onOpen(node.path)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <File className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
        {status && <span className={`shrink-0 font-mono text-[10px] font-bold ${STATUS_STYLE[status]}`}>{status}</span>}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { if (query.length > 0) setForceShut(s => !s); else setOpen(o => !o); }}
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
      {expanded && [...node.children.values()].map(child => (
        <TreeNode key={child.path} node={child} depth={depth + 1} query={query} statusByPath={statusByPath} onOpen={onOpen} />
      ))}
    </div>
  );
}
