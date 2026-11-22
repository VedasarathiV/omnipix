import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useStudio } from '../state/store';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { IconRail } from './IconRail';
import { BottomPanel, FileModal } from './BottomPanel';

function stored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function VDivider({ label, onResize, onReset }: { label: string; onResize: (e: React.MouseEvent) => void; onReset: () => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      onMouseDown={onResize}
      onDoubleClick={onReset}
      className="group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center md:flex"
    >
      <div className="mx-auto w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent" />
    </div>
  );
}

function HDivider({ label, onResize, onReset }: { label: string; onResize: (e: React.MouseEvent) => void; onReset: () => void }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      onMouseDown={onResize}
      onDoubleClick={onReset}
      className="group flex h-3 w-full shrink-0 cursor-row-resize items-center justify-center"
    >
      <div className="h-px w-full bg-line transition-colors group-hover:h-0.5 group-hover:bg-accent" />
    </div>
  );
}

export function AppShell({ sidebar, main }: { sidebar: ReactNode; main: ReactNode }) {
  const { sidebarOpen, panelOpen, rail } = useStudio();
  const [sideWidth, setSideWidth] = useState(() => stored('studio:side-w', 260));
  const [panelHeight, setPanelHeight] = useState(() => stored('studio:panel-h', 260));
  // The panel shows run state (changes, terminal, preview, logs): on library
  // pages it would be dead weight, so it only renders where runs live.
  const showPanel = panelOpen && (rail === 'chat' || rail === 'agents');

  useEffect(() => {
    try {
      localStorage.setItem('studio:side-w', String(sideWidth));
      localStorage.setItem('studio:panel-h', String(panelHeight));
    } catch {
      // Private mode: preference just doesn't persist.
    }
  }, [sideWidth, panelHeight]);

  const dragX = useCallback((set: (w: number) => void, min: number, max: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const panel = e.currentTarget.previousElementSibling;
    const startEl = panel?.getBoundingClientRect().width ?? 260;
    function onMove(ev: MouseEvent) {
      set(Math.min(max, Math.max(min, startEl + ev.clientX - startX)));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const dragY = useCallback((set: (h: number) => void, min: number, max: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const panel = e.currentTarget.nextElementSibling;
    const startEl = panel?.getBoundingClientRect().height ?? 260;
    function onMove(ev: MouseEvent) {
      set(Math.min(max, Math.max(min, startEl + startY - ev.clientY)));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div className="flex h-full flex-col bg-base-0 text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <IconRail />
        {sidebarOpen && (
          <>
            <aside style={{ width: sideWidth }} className="hidden min-h-0 shrink-0 flex-col border-r border-line bg-base-1 md:flex">
              {sidebar}
            </aside>
            <VDivider label="Resize sidebar" onResize={dragX(setSideWidth, 200, 420)} onReset={() => setSideWidth(260)} />
          </>
        )}
        <main className="flex min-w-0 flex-1 flex-col bg-base-0">
          <div className="flex min-h-0 flex-1 flex-col">{main}</div>
          {showPanel && (
            <>
              <HDivider label="Resize panel" onResize={dragY(setPanelHeight, 160, 520)} onReset={() => setPanelHeight(260)} />
              <section style={{ height: panelHeight }} className="shrink-0 border-t border-line bg-base-1" aria-label="Panel">
                <BottomPanel />
              </section>
            </>
          )}
        </main>
      </div>
      <StatusBar />
      <FileModal />
    </div>
  );
}
