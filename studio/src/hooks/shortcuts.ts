import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import type { RailId } from '../types';

const RAIL_ORDER: RailId[] = ['chat', 'agents', 'skills', 'keys', 'models', 'evals', 'search', 'docs', 'notifications', 'voice'];

/** Global keyboard map. Inputs keep their own keys; Escape stops the live run. */
export function useShortcuts() {
  const {
    setPaletteOpen, setSettingsOpen, setRail, setMode, mode, paletteOpen, settingsOpen,
    activeRunId, pushToast, sidebarOpen, setSidebarOpen, rightOpen, setRightOpen,
    setConversationId, setActiveRunId,
  } = useStudio();
  const queryClient = useQueryClient();

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
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setConversationId(null);
        setActiveRunId(null);
        setRail('chat');
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarOpen(!sidebarOpen);
        return;
      }
      if (mod && e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setRightOpen(!rightOpen);
        return;
      }
      if (typing) return;
      if (e.key === 'Escape' && activeRunId !== null) {
        apiFetch(`/api/agents/runs/${activeRunId}/stop`, { method: 'POST' })
          .then(() => {
            pushToast('ok', `Run #${activeRunId} stopped`);
            void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
            void queryClient.invalidateQueries({ queryKey: ['agent-run', activeRunId] });
          })
          .catch(() => {
            // Already landed — nothing to stop.
          });
        return;
      }
      if (mod && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        setRail(RAIL_ORDER[Number(e.key) - 1]);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        setRail('voice');
        return;
      }
      if (mod && e.key === '.') {
        e.preventDefault();
        setMode(mode === 'ask' ? 'plan' : mode === 'plan' ? 'agent' : 'ask');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, settingsOpen, mode, activeRunId, sidebarOpen, rightOpen, setPaletteOpen, setSettingsOpen, setRail, setMode, pushToast, queryClient, setSidebarOpen, setRightOpen, setConversationId, setActiveRunId]);
}
