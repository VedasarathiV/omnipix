import { useEffect } from 'react';
import type { RailId } from '../types';
import { useStudio } from '../state/store';

// Native-menu bridge: the Electron main process pushes UI intents through the
// receive-only __OMNIPIX_MENU__ preload object (desktop/src/preload.ts falls
// back to undefined on the web, so this hook is a no-op outside the app).
const RAILS: ReadonlySet<string> = new Set([
  'chat', 'agents', 'skills', 'keys', 'models', 'evals',
  'search', 'docs', 'settings', 'notifications', 'voice',
]);

type MenuAction =
  | { kind: 'navigate'; rail: string }
  | { kind: 'new-chat' }
  | { kind: 'open-settings' };

export function useNativeMenu(): void {
  const { setRail, setConversationId, setSettingsOpen } = useStudio();
  useEffect(() => {
    const bridge = (window as unknown as {
      __OMNIPIX_MENU__?: { onAction: (cb: (a: MenuAction) => void) => () => void };
    }).__OMNIPIX_MENU__;
    if (!bridge) return;
    return bridge.onAction((action) => {
      if (action.kind === 'navigate' && RAILS.has(action.rail)) {
        setRail(action.rail as RailId);
      } else if (action.kind === 'new-chat') {
        setConversationId(null);
        setRail('chat');
      } else if (action.kind === 'open-settings') {
        setSettingsOpen(true);
      }
    });
  }, [setRail, setConversationId, setSettingsOpen]);
}
