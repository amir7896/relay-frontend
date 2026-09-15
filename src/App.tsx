import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import { AuthProvider } from './auth/AuthContext';
import { OrganizationProvider } from './organizations/OrganizationContext';
import { ThemeProvider } from './theme/ThemeContext';
import { WorkspaceProvider } from './theme/WorkspaceContext';
import { ConfirmProvider } from './components/ConfirmProvider';
import { AppShell } from './components/AppShell';
import { GuestLayout } from './components/GuestLayout';
import { Protected } from './components/Protected';
import { RequireWorkspace } from './components/RequireWorkspace';

const EmptyThread = lazy(() =>
  import('./pages/chat/EmptyThread').then((m) => ({ default: m.EmptyThread })),
);
const MessengerPage = lazy(() =>
  import('./pages/chat/MessengerPage').then((m) => ({ default: m.MessengerPage })),
);
const ConversationDetailsPage = lazy(() =>
  import('./pages/chat/ConversationDetailsPage').then((m) => ({
    default: m.ConversationDetailsPage,
  })),
);
const ThreadView = lazy(() =>
  import('./pages/chat/ThreadView').then((m) => ({ default: m.ThreadView })),
);
const LandingPage = lazy(() =>
  import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const PeoplePage = lazy(() =>
  import('./pages/PeoplePage').then((m) => ({ default: m.PeoplePage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const BlockedUsersPage = lazy(() =>
  import('./pages/BlockedUsersPage').then((m) => ({
    default: m.BlockedUsersPage,
  })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const VerifyEmailPage = lazy(() =>
  import('./pages/VerifyEmailPage').then((m) => ({
    default: m.VerifyEmailPage,
  })),
);
const InviteAcceptPage = lazy(() =>
  import('./pages/InviteAcceptPage').then((m) => ({
    default: m.InviteAcceptPage,
  })),
);
const ChannelInviteAcceptPage = lazy(() =>
  import('./pages/chat/ChannelInviteAcceptPage').then((m) => ({
    default: m.ChannelInviteAcceptPage,
  })),
);
const OnboardingPage = lazy(() =>
  import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);
const SsoCallbackPage = lazy(() =>
  import('./pages/SsoCallbackPage').then((m) => ({
    default: m.SsoCallbackPage,
  })),
);

function RouteFallback() {
  return (
    <div className="pad muted" style={{ padding: 24 }}>
      Loading…
    </div>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <OrganizationProvider>
            <BrowserRouter>
              <ConfirmProvider>
                <Lazy>
                  <Routes>
                    <Route element={<GuestLayout />}>
                      <Route path="/" element={<LandingPage />} />
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/sso/callback" element={<SsoCallbackPage />} />
                      <Route path="/register" element={<RegisterPage />} />
                      <Route
                        path="/forgot-password"
                        element={<ForgotPasswordPage />}
                      />
                      <Route
                        path="/reset-password"
                        element={<ResetPasswordPage />}
                      />
                      <Route path="/verify-email" element={<VerifyEmailPage />} />
                      <Route path="/invite/:token" element={<InviteAcceptPage />} />
                    </Route>
                    <Route element={<Protected />}>
                      <Route path="/onboarding" element={<OnboardingPage />} />
                      <Route element={<RequireWorkspace />}>
                        <Route
                          path="/channel-invite/:token"
                          element={<ChannelInviteAcceptPage />}
                        />
                        <Route element={<AppShell />}>
                          <Route path="/chat" element={<MessengerPage />}>
                            <Route index element={<EmptyThread />} />
                            <Route
                              path=":id/details"
                              element={<ConversationDetailsPage />}
                            />
                            <Route path=":id" element={<ThreadView />} />
                          </Route>
                          <Route path="/profile" element={<ProfilePage />} />
                          <Route path="/blocked" element={<BlockedUsersPage />} />
                          <Route path="/people" element={<PeoplePage />} />
                          <Route path="/analytics" element={<AnalyticsPage />} />
                        </Route>
                      </Route>
                    </Route>
                    <Route
                      path="/auth/login"
                      element={<Navigate to="/login" replace />}
                    />
                    <Route
                      path="/auth/register"
                      element={<Navigate to="/register" replace />}
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Lazy>
              </ConfirmProvider>
            </BrowserRouter>
          </OrganizationProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
