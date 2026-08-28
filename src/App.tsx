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
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';

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
              </Route>
              <Route element={<Protected />}>
                <Route element={<AppShell />}>
                  <Route path="/chat" element={<MessengerPage />}>
                    <Route index element={<EmptyThread />} />
                    <Route path=":id" element={<ThreadView />} />
                  </Route>
                  <Route path="/profile" element={<ProfilePage />} />
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
