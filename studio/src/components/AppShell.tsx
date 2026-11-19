import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { IconRail } from './IconRail';
import { TopBar } from './TopBar';
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

export function AppShell({ sidebar, main, right }: { sidebar: ReactNode; main: ReactNode; right: ReactNode }) {
  const { sidebarOpen, rightOpen } = useStudio();
  const [sideWidth, setSideWidth] = useState(() => stored('studio:side-w', 256));
  const [rightWidth, setRightWidth] = useState(() => stored('studio:right-w', 380));

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
    const startEl = flip
      ? (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 380)
      : (e.currentTarget.parentElement?.previousElementSibling?.getBoundingClientRect().width ?? 256);
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
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onMouseDown={drag(setSideWidth, 200, 420, false)}
              className="hidden w-1 shrink-0 cursor-col-resize hover:bg-accent/40 md:block"
            />
          </>
        )}
        <main className="flex min-w-0 flex-1 flex-col bg-base-0">{main}</main>
        {rightOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inspector"
              onMouseDown={drag(setRightWidth, 300, 640, true)}
              className="hidden w-1 shrink-0 cursor-col-resize hover:bg-accent/40 lg:block"
            />
            <aside style={{ width: rightWidth }} className="hidden min-h-0 shrink-0 flex-col border-l border-line bg-base-1 lg:flex">
              {right}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
