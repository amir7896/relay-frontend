import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext';
import { getAccessToken, getSession } from '../auth/session';

type SocketListener = (...args: unknown[]) => void;

type ChatSocketContextValue = {
  connected: boolean;
  joinConversation: (conversationId: string) => void;
  leaveConversation: (conversationId: string) => void;
  subscribe: (event: string, listener: SocketListener) => () => void;
  emit: (event: string, payload?: unknown) => void;
  emitAck: <T = unknown>(event: string, payload?: unknown, timeoutMs?: number) => Promise<T>;
};

const ChatSocketContext = createContext<ChatSocketContextValue | null>(null);

export function ChatSocketProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const activeConversationRef = useRef<string | null>(null);
  /** Stable listener registry so subscriptions work even before the socket exists. */
  const listenersRef = useRef(new Map<string, Set<SocketListener>>());
  const [connected, setConnected] = useState(false);

  const attachAllListeners = useCallback((socket: Socket) => {
    for (const [event, listeners] of listenersRef.current) {
      for (const listener of listeners) {
        socket.on(event, listener);
      }
    }
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const socket = io('/chat', {
      auth: {
        token,
        organizationId: getSession()?.activeOrganizationId ?? undefined,
      },
      transports: ['websocket', 'polling'],
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true',
      },
      transportOptions: {
        polling: {
          extraHeaders: {
            'ngrok-skip-browser-warning': 'true',
          },
        },
      },
    });
    socketRef.current = socket;
    attachAllListeners(socket);

    const onConnect = () => {
      setConnected(true);
      socket.emit('chat:heartbeat');
      if (activeConversationRef.current) {
        socket.emit('chat:join', { conversationId: activeConversationRef.current });
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) {
      onConnect();
    }

    const beat = window.setInterval(() => socket.emit('chat:heartbeat'), 20_000);

    return () => {
      window.clearInterval(beat);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const [event, listeners] of listenersRef.current) {
        for (const listener of listeners) {
          socket.off(event, listener);
        }
      }
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [attachAllListeners, session?.user.id, session?.activeOrganizationId]);

  const joinConversation = useCallback((conversationId: string) => {
    activeConversationRef.current = conversationId;
    socketRef.current?.emit('chat:join', { conversationId });
  }, []);

  const leaveConversation = useCallback((conversationId: string) => {
    if (activeConversationRef.current === conversationId) {
      activeConversationRef.current = null;
    }
    socketRef.current?.emit('chat:leave', { conversationId });
  }, []);

  const subscribe = useCallback((event: string, listener: SocketListener) => {
    let bucket = listenersRef.current.get(event);
    if (!bucket) {
      bucket = new Set();
      listenersRef.current.set(event, bucket);
    }
    bucket.add(listener);
    socketRef.current?.on(event, listener);

    return () => {
      const set = listenersRef.current.get(event);
      set?.delete(listener);
      if (set && set.size === 0) {
        listenersRef.current.delete(event);
      }
      socketRef.current?.off(event, listener);
    };
  }, []);

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const emitAck = useCallback(
    <T = unknown,>(event: string, payload?: unknown, timeoutMs = 12_000): Promise<T> => {
      const socket = socketRef.current;
      if (!socket) {
        return Promise.reject(new Error('Socket is not connected'));
      }
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          socket.off('exception', onException);
          fn();
        };

        // Nest WsException uses client.emit('exception') instead of ACK error
        const onException = (exception: unknown) => {
          if (!exception || typeof exception !== 'object') {
            return;
          }
          const record = exception as {
            status?: unknown;
            message?: unknown;
            cause?: { pattern?: unknown };
          };
          const pattern = record.cause?.pattern;
          if (typeof pattern === 'string' && pattern !== event) {
            return;
          }
          const message =
            typeof record.message === 'string' && record.message.trim()
              ? record.message
              : 'Request failed';
          finish(() => reject(new Error(message)));
        };
        socket.on('exception', onException);

        socket
          .timeout(timeoutMs)
          .emit(event, payload ?? {}, (error: Error | null, response: T) => {
            if (error) {
              finish(() => reject(error));
              return;
            }
            if (response && typeof response === 'object') {
              const record = response as {
                status?: unknown;
                error?: unknown;
                message?: unknown;
              };
              if (typeof record.status === 'string' && record.status.startsWith('error')) {
                const message =
                  typeof record.message === 'string' && record.message.trim()
                    ? record.message
                    : 'Request failed';
                finish(() => reject(new Error(message)));
                return;
              }
              if (typeof record.error === 'string' && record.error.trim()) {
                finish(() => reject(new Error(record.error as string)));
                return;
              }
            }
            finish(() => resolve(response));
          });
      });
    },
    [],
  );

  const value = useMemo(
    () => ({
      connected,
      joinConversation,
      leaveConversation,
      subscribe,
      emit,
      emitAck,
    }),
    [connected, joinConversation, leaveConversation, subscribe, emit, emitAck],
  );

  return (
    <ChatSocketContext.Provider value={value}>{children}</ChatSocketContext.Provider>
  );
}

export function useChatSocket() {
  const context = useContext(ChatSocketContext);
  if (!context) {
    throw new Error('useChatSocket must be used within ChatSocketProvider');
  }
  return context;
}
