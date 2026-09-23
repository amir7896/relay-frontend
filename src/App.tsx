import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  Suspense,
  lazy,
  type ComponentType,
  type ReactNode,
} from 'react';
import { AuthProvider } from './auth/AuthContext';
import { OrganizationProvider } from './organizations/OrganizationContext';
import { ThemeProvider } from './theme/ThemeContext';
import { WorkspaceProvider } from './theme/WorkspaceContext';
import { ConfirmProvider } from './components/ConfirmProvider';
import { AppShell } from './components/AppShell';
import { GuestLayout } from './components/GuestLayout';
import { Protected } from './components/Protected';
import { RequireWorkspace } from './components/RequireWorkspace';

function lazyNamed<T extends Record<string, unknown>>(
  loader: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(async () => {
    const mod = await loader();
    const Comp = mod[name];
    if (typeof Comp !== 'function') {
      throw new Error(
        `Lazy route "${name}" resolved to ${String(Comp)} — check the module export`,
      );
    }
    return { default: Comp as ComponentType };
  });
}

const EmptyThread = lazyNamed(
  () => import('./pages/chat/EmptyThread'),
  'EmptyThread',
);
const MessengerPage = lazyNamed(
  () => import('./pages/chat/MessengerPage'),
  'MessengerPage',
);
const ConversationDetailsPage = lazyNamed(
  () => import('./pages/chat/ConversationDetailsPage'),
  'ConversationDetailsPage',
);
const ThreadView = lazyNamed(
  () => import('./pages/chat/ThreadView'),
  'ThreadView',
);
const LandingPage = lazyNamed(() => import('./pages/LandingPage'), 'LandingPage');
const LoginPage = lazyNamed(() => import('./pages/LoginPage'), 'LoginPage');
const PeoplePage = lazyNamed(() => import('./pages/PeoplePage'), 'PeoplePage');
const AnalyticsPage = lazyNamed(
  () => import('./pages/AnalyticsPage'),
  'AnalyticsPage',
);
const BlockedUsersPage = lazyNamed(
  () => import('./pages/BlockedUsersPage'),
  'BlockedUsersPage',
);
const ProfilePage = lazyNamed(() => import('./pages/ProfilePage'), 'ProfilePage');
const RegisterPage = lazyNamed(
  () => import('./pages/RegisterPage'),
  'RegisterPage',
);
const ForgotPasswordPage = lazyNamed(
  () => import('./pages/ForgotPasswordPage'),
  'ForgotPasswordPage',
);
const ResetPasswordPage = lazyNamed(
  () => import('./pages/ResetPasswordPage'),
  'ResetPasswordPage',
);
const VerifyEmailPage = lazyNamed(
  () => import('./pages/VerifyEmailPage'),
  'VerifyEmailPage',
);
const InviteAcceptPage = lazyNamed(
  () => import('./pages/InviteAcceptPage'),
  'InviteAcceptPage',
);
const ChannelInviteAcceptPage = lazyNamed(
  () => import('./pages/chat/ChannelInviteAcceptPage'),
  'ChannelInviteAcceptPage',
);
const ConnectAcceptPage = lazyNamed(
  () => import('./pages/chat/ConnectAcceptPage'),
  'ConnectAcceptPage',
);
const OnboardingPage = lazyNamed(
  () => import('./pages/OnboardingPage'),
  'OnboardingPage',
);
const SsoCallbackPage = lazyNamed(
  () => import('./pages/SsoCallbackPage'),
  'SsoCallbackPage',
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
                      <Route
                        path="/channel-invite/:token"
                        element={<ChannelInviteAcceptPage />}
                      />
                      <Route
                        path="/connect-invite/:token"
                        element={<ConnectAcceptPage />}
                      />
                    </Route>
                    <Route element={<Protected />}>
                      <Route path="/onboarding" element={<OnboardingPage />} />
                      <Route element={<RequireWorkspace />}>
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
