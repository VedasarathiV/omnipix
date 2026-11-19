import { useState } from 'react';
import { StudioProvider, useStudio } from './state/store';
import { useShortcuts } from './hooks/shortcuts';
import { useIsMobile } from './hooks/mobile';
import { AppShell } from './components/AppShell';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { InputBar } from './components/InputBar';
import { RightPanel } from './components/RightPanel';
import { CommandPalette } from './components/CommandPalette';
import { SettingsModal } from './components/SettingsModal';
import { AgentEditor } from './components/AgentEditor';
import { Splash } from './components/Splash';
import { Toasts } from './components/Toasts';
import { FloatingMic } from './components/FloatingMic';
import { Onboarding } from './components/Onboarding';
import { MobileBar } from './components/MobileBar';
import type { MobilePane } from './components/MobileBar';
import { AgentsPage } from './pages/AgentsPage';
import { SkillsPage } from './pages/SkillsPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { EvalsPage } from './pages/EvalsPage';
import { SearchPage } from './pages/SearchPage';
import { DocsPage } from './pages/DocsPage';
import { VoicePage } from './pages/VoicePage';
import { NotificationsPanel } from './components/NotificationsPanel';

function MainPane() {
  const { rail } = useStudio();
  if (rail === 'chat') {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatView />
        <InputBar />
        <FloatingMic />
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {rail === 'agents' && <AgentsPage />}
      {rail === 'skills' && <SkillsPage />}
      {rail === 'keys' && <ProvidersPage />}
      {rail === 'evals' && <EvalsPage />}
      {rail === 'search' && <SearchPage />}
      {rail === 'docs' && <DocsPage />}
      {rail === 'voice' && <VoicePage />}
      {rail === 'notifications' && <NotificationsPanel />}
      {rail === 'settings' && <ProvidersPage />}
    </div>
  );
}

function Shell() {
  useShortcuts();
  const mobile = useIsMobile();
  const [pane, setPane] = useState<MobilePane>('chat');

  if (mobile) {
    return (
      <div className="flex h-full flex-col bg-base-0 text-ink">
        <div className="flex min-h-0 flex-1 flex-col">
          {pane === 'chat' && <MainPane />}
          {pane === 'files' && <Sidebar />}
          {pane === 'changes' && <RightPanel />}
        </div>
        <MobileBar pane={pane} setPane={setPane} />
      </div>
    );
  }

  return <AppShell sidebar={<Sidebar />} main={<MainPane />} right={<RightPanel />} />;
}

export function App() {
  return (
    <StudioProvider>
      <Shell />
      <CommandPalette />
      <SettingsModal />
      <AgentEditor />
      <Onboarding />
      <Splash />
      <Toasts />
    </StudioProvider>
  );
}
