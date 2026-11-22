import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { IconRail } from './IconRail';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { useStudio } from '../state/store';

function stored(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function Divider({ label, onResize, onReset, showAt }: { label: string; onResize: (e: React.MouseEvent) => void; onReset: () => void; showAt: 'md:flex' | 'lg:flex' }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      onMouseDown={onResize}
      onDoubleClick={onReset}
      className={`group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center ${showAt}`}
    >
      <div className="mx-auto w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent" />
    </div>
  );
}

export function AppShell({ sidebar, main, right }: { sidebar: ReactNode; main: ReactNode; right: ReactNode }) {
  const { sidebarOpen, rightOpen, rail } = useStudio();
  // The inspector shows run state (changes, files, terminal, preview, logs):
  // on library pages it is a permanent "No run selected" dead zone, so it
  // only renders where runs live.
  const showRight = rightOpen && (rail === 'chat' || rail === 'agents');
  const [sideWidth, setSideWidth] = useState(() => stored('studio:side-w', 260));
  const [rightWidth, setRightWidth] = useState(() => stored('studio:right-w', 340));

  useEffect(() => {
    try {
      window.localStorage.setItem('studio:side-w', String(sideWidth));
      window.localStorage.setItem('studio:right-w', String(rightWidth));
    } catch {
      // Private mode: sizes just don't persist.
    }
  }, [sideWidth, rightWidth]);

  const drag = useCallback((set: (w: number) => void, min: number, max: number, flip: boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    // The divider sits between the panels: measure the aside it touches, not
    // the row (measuring the row snapped every drag straight to the max).
    const panel = flip ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
    const startEl = panel?.getBoundingClientRect().width ?? (flip ? 340 : 260);
    function onMove(ev: MouseEvent) {
      const delta = flip ? startX - ev.clientX : ev.clientX - startX;
      set(Math.min(max, Math.max(min, startEl + delta)));
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
            <Divider label="Resize sidebar" showAt="md:flex" onResize={drag(setSideWidth, 200, 420, false)} onReset={() => setSideWidth(260)} />
          </>
        )}
        <main className="flex min-w-0 flex-1 flex-col bg-base-0">{main}</main>
        {showRight && (
          <>
            <Divider label="Resize inspector" showAt="lg:flex" onResize={drag(setRightWidth, 300, 640, true)} onReset={() => setRightWidth(340)} />
            <aside style={{ width: rightWidth }} className="hidden min-h-0 shrink-0 flex-col border-l border-line bg-base-1 lg:flex">
              {right}
            </aside>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
