import { useEffect } from 'react';
import { useStudio } from '../state/store';
import type { RailId } from '../types';

const RAIL_ORDER: RailId[] = ['chat', 'agents', 'skills', 'keys', 'evals', 'search', 'docs', 'notifications', 'voice'];

/** Global keyboard map. Inputs keep their own keys; Escape stops runs. */
export function useShortcuts() {
  const { setPaletteOpen, setSettingsOpen, setRail, setRunStatus, runStatus, setMode, mode, paletteOpen, settingsOpen } = useStudio();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName ?? '');
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(!settingsOpen);
        return;
      }
      if (typing) return;
      if (e.key === 'Escape' && (runStatus === 'running' || runStatus === 'thinking')) {
        setRunStatus('idle');
        return;
      }
      if (mod && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        setRail(RAIL_ORDER[Number(e.key) - 1]);
        return;
      }
      if (mod && e.key === '.') {
        e.preventDefault();
        setMode(mode === 'ask' ? 'plan' : mode === 'plan' ? 'agent' : 'ask');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, settingsOpen, runStatus, mode, setPaletteOpen, setSettingsOpen, setRail, setRunStatus, setMode]);
}
