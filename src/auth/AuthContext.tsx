import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { AuthResult } from '../api/types';
import { clearSession, getSession, setSession, type Session } from './session';

type RegisterInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  inviteToken?: string;
};

type AuthContextValue = {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toSession(result: AuthResult): Session {
  return {
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    user: {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      isEmailVerified: result.user.isEmailVerified,
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => getSession());

  const apply = useCallback((result: AuthResult) => {
    const next = toSession(result);
    setSession(next);
    setSessionState(next);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api<AuthResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      apply(response.data);
    },
    [apply],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const response = await api<AuthResult>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      apply(response.data);
    },
    [apply],
  );

  const logout = useCallback(async () => {
    const current = getSession();
    try {
      if (current?.refreshToken) {
        await api('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
      }
    } catch {
      // local sign-out still happens
    }
    clearSession();
    setSessionState(null);
  }, []);

  const value = useMemo(
    () => ({ session, login, register, logout }),
    [session, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
