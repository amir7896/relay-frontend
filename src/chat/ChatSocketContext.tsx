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
import { getAccessToken } from '../auth/session';

type SocketListener = (...args: unknown[]) => void;

type ChatSocketContextValue = {
  connected: boolean;
  joinConversation: (conversationId: string) => void;
  subscribe: (event: string, listener: SocketListener) => () => void;
  emit: (event: string, payload?: unknown) => void;
};

const ChatSocketContext = createContext<ChatSocketContextValue | null>(null);

export function ChatSocketProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const activeConversationRef = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!session) {
      return;
    }
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const socket = io('/chat', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

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
    setVersion((value) => value + 1);

    const beat = window.setInterval(() => socket.emit('chat:heartbeat'), 20_000);

    return () => {
      window.clearInterval(beat);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [session?.user.id]);

  const joinConversation = useCallback((conversationId: string) => {
    activeConversationRef.current = conversationId;
    socketRef.current?.emit('chat:join', { conversationId });
  }, []);

  const subscribe = useCallback(
    (event: string, listener: SocketListener) => {
      const socket = socketRef.current;
      if (!socket) {
        return () => undefined;
      }
      socket.on(event, listener);
      return () => {
        socket.off(event, listener);
      };
    },
    [version],
  );

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const value = useMemo(
    () => ({ connected, joinConversation, subscribe, emit }),
    [connected, joinConversation, subscribe, emit],
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
