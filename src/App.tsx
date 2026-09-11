import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { WorkspaceProvider } from './theme/WorkspaceContext';
import { AppShell } from './components/AppShell';
import { GuestLayout } from './components/GuestLayout';
import { Protected } from './components/Protected';
import { EmptyThread } from './pages/chat/EmptyThread';
import { MessengerPage } from './pages/chat/MessengerPage';
import { ThreadView } from './pages/chat/ThreadView';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { PeoplePage } from './pages/PeoplePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { BlockedUsersPage } from './pages/BlockedUsersPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { InviteAcceptPage } from './pages/InviteAcceptPage';

export function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<GuestLayout />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/invite/:token" element={<InviteAcceptPage />} />
              </Route>
              <Route element={<Protected />}>
                <Route element={<AppShell />}>
                  <Route path="/chat" element={<MessengerPage />}>
                    <Route index element={<EmptyThread />} />
                    <Route path=":id" element={<ThreadView />} />
                  </Route>
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/blocked" element={<BlockedUsersPage />} />
                  <Route path="/people" element={<PeoplePage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                </Route>
              </Route>
              <Route path="/auth/login" element={<Navigate to="/login" replace />} />
              <Route path="/auth/register" element={<Navigate to="/register" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
