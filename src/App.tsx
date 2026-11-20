import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { AuthProvider } from '@/auth/AuthProvider';
import { useAuth } from '@/auth/useAuth';
import { AppShell } from '@/components/AppShell';
import { AssessorWorkspace } from '@/features/assessments/AssessorWorkspace';
import { ErrorScreen, LoadingScreen } from '@/components/StatusScreens';
import { ActivatePage } from '@/pages/ActivatePage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { linkTokenFromPath } from '@/features/link/linkApi';
import { trackView } from '@/lib/telemetry';
import { EvaluationLinkPage } from '@/pages/EvaluationLinkPage';
import { MyProfilePage } from '@/pages/MyProfilePage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { NotificationSettingsPage } from '@/features/notifications/NotificationSettingsPage';
import { SenderSettingsPage } from '@/features/notifications/SenderSettingsPage';
import { TeamPage } from '@/features/org/TeamPage';
import { hasWorkspaceAccess, type Profile } from '@/lib/types';

type HomeView = { label: string; content: ReactNode };

function homeViews(profile: Profile): HomeView[] {
  const views: HomeView[] = [];
  // Everyone is an assessor and is assessed: every person has their evaluations and their own report.
  views.push({ label: 'My assessments', content: <AssessorWorkspace profile={profile} /> });
  views.push({ label: 'My report', content: <HomePage profile={profile} /> });
  if (profile.role === 'admin' || hasWorkspaceAccess(profile)) {
    views.push({ label: 'Workspace', content: <WorkspacePage profile={profile} mode="admin" /> });
  }
  // Manager features come from having direct reports in the org structure.
  if (profile.manages_talents) {
    views.push({ label: 'My team', content: <TeamPage profile={profile} /> });
  }
  return views;
}

function HomeViews({ profile }: { profile: Profile }) {
  const views = homeViews(profile);
  const [selected, setSelected] = useState(0);
  const active = views[selected] ?? views[0];
  useEffect(() => {
    if (active) trackView(active.label);
  }, [active]);

  if (views.length === 1) return <>{active.content}</>;

  return (
    <div className="space-y-8">
      <div role="tablist" aria-label="Home views" className="flex gap-1 rounded-2xl bg-muted p-1">
        {views.map((view, index) => {
          const isSelected = active === view;
          return (
            <button
              key={view.label}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelected(index)}
              className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-200 sm:px-4 ${
                isSelected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {view.label}
            </button>
          );
        })}
      </div>
      {active.content}
    </div>
  );
}

// The Gmail approval callback returns to /?settings=sender&gmail=connected.
function readSettingsLink(): { openSender: boolean; gmail: 'connected' | 'failed' | null } {
  const params = new URLSearchParams(window.location.search);
  const gmail = params.get('gmail');
  return {
    openSender: params.get('settings') === 'sender',
    gmail: gmail === 'connected' || gmail === 'failed' ? gmail : null,
  };
}

function AppGate() {
  const { state, signOut } = useAuth();
  const [settingsLink] = useState(readSettingsLink);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSenderSettings, setShowSenderSettings] = useState(false);
  // Notifications and sender settings are for administrators only.
  const isAdmin = state.status === 'signed_in' && state.profile.role === 'admin';
  const canOpenSender = isAdmin;

  useEffect(() => {
    if (!settingsLink.openSender || !canOpenSender) return;
    setShowNotifications(true);
    setShowSenderSettings(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, [settingsLink.openSender, canOpenSender]);

  function openProfile() {
    setShowNotifications(false);
    setShowSenderSettings(false);
    setShowProfile(true);
    window.scrollTo({ top: 0 });
  }

  function openNotifications() {
    setShowProfile(false);
    setShowSenderSettings(false);
    setShowNotifications(true);
    window.scrollTo({ top: 0 });
  }

  function backToHome() {
    setShowProfile(false);
    setShowNotifications(false);
    setShowSenderSettings(false);
  }

  switch (state.status) {
    case 'loading':
      return <LoadingScreen />;
    case 'signed_out':
      return window.location.pathname === '/activate' ? <ActivatePage /> : <LoginPage />;
    case 'error':
      return <ErrorScreen message={state.message} onSignOut={() => void signOut()} />;
    case 'signed_in':
      if (state.profile.must_change_password) {
        return <ChangePasswordPage />;
      }
      return (
        <AppShell
          profile={state.profile}
          onOpenNotifications={isAdmin ? openNotifications : undefined}
          onOpenProfile={openProfile}
        >
          {showProfile ? (
            <div className="space-y-8">
              <button
                type="button"
                onClick={backToHome}
                className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
              <MyProfilePage profile={state.profile} />
            </div>
          ) : showNotifications && isAdmin ? (
            <div className="space-y-8">
              <button
                type="button"
                onClick={backToHome}
                className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
              {showSenderSettings ? (
                <SenderSettingsPage gmailResult={settingsLink.gmail} />
              ) : (
                <NotificationSettingsPage
                  profile={state.profile}
                  onOpenSenderSettings={() => setShowSenderSettings(true)}
                />
              )}
            </div>
          ) : (
            <HomeViews profile={state.profile} />
          )}
        </AppShell>
      );
  }
}

function App() {
  // Public page, no sign-in: linked from Google's consent screen (Branding).
  if (window.location.pathname.replace(/\/+$/, '') === '/privacy') return <PrivacyPage />;
  // Secure feedback link: no sign-in, the token is the credential.
  const linkToken = linkTokenFromPath(window.location.pathname);
  if (linkToken) return <EvaluationLinkPage token={linkToken} />;
  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  );
}

export default App;
