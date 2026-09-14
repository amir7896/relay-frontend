import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { Paginated, UserProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';

type DirectoryContextValue = {
  people: UserProfile[];
  byUserId: Map<string, UserProfile>;
  error: string;
  refreshDirectory: () => Promise<void>;
  ensureProfiles: (
    userIds: string[],
    options?: { refresh?: boolean },
  ) => Promise<void>;
};

const DirectoryContext = createContext<DirectoryContextValue | null>(null);

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const me = session?.user.id;
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [error, setError] = useState('');

  const refreshDirectory = useCallback(async () => {
    try {
      const response = await api<Paginated<UserProfile>>(
        '/users/directory?page=1&limit=100&sortBy=firstName&order=ASC',
      );
      setPeople(response.data.items);
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load people');
    }
  }, []);

  useEffect(() => {
    void refreshDirectory();
  }, [refreshDirectory]);

  const byUserId = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const person of people) {
      map.set(person.userId, person);
    }
    return map;
  }, [people]);

  const ensureProfiles = useCallback(
    async (userIds: string[], options?: { refresh?: boolean }) => {
      const missing = [...new Set(userIds)].filter((userId) => {
        if (!userId) return false;
        if (options?.refresh) return true;
        return !byUserId.has(userId);
      });
      if (missing.length === 0) {
        return;
      }

      const loaded = await Promise.all(
        missing.map(async (userId) => {
          try {
            const response = await api<UserProfile>(`/users/lookup/${userId}`);
            return response.data;
          } catch {
            return null;
          }
        }),
      );

      const found = loaded.filter((item): item is UserProfile => item !== null);
      if (found.length === 0) {
        return;
      }

      setPeople((current) => {
        const map = new Map(current.map((person) => [person.userId, person]));
        for (const person of found) {
          map.set(person.userId, person);
        }
        return [...map.values()];
      });
    },
    [byUserId],
  );

  const others = useMemo(
    () => people.filter((person) => person.userId !== me),
    [people, me],
  );

  const value = useMemo(
    () => ({
      people: others,
      byUserId,
      error,
      refreshDirectory,
      ensureProfiles,
    }),
    [others, byUserId, error, refreshDirectory, ensureProfiles],
  );

  return (
    <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>
  );
}

export function useDirectory() {
  const value = useContext(DirectoryContext);
  if (!value) {
    throw new Error('useDirectory must be used within DirectoryProvider');
  }
  return value;
}
