import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import * as awarenessProtocol from 'y-protocols/awareness';
import { useAuth } from '../../../auth/AuthContext';
import { useChatSocket } from '../../../chat/ChatSocketContext';
import { displayName } from '../../../lib/format';
import { useDirectory } from '../../../people/useDirectory';

export type CanvasPeerCursor = {
  clientId: number;
  userId: string;
  name: string;
  color: string;
  field: 'title' | 'body';
  anchor: number;
  head: number;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 70% 45%)`;
}

/** Apply a minimal prefix/suffix text diff into a Y.Text. */
export function applyYTextDiff(ytext: Y.Text, next: string) {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev.charAt(start) === next.charAt(start)) {
    start += 1;
  }
  let endPrev = prev.length - 1;
  let endNext = next.length - 1;
  while (
    endPrev >= start &&
    endNext >= start &&
    prev.charAt(endPrev) === next.charAt(endNext)
  ) {
    endPrev -= 1;
    endNext -= 1;
  }
  const deleteCount = Math.max(0, endPrev - start + 1);
  const insert = next.slice(start, endNext + 1);
  if (deleteCount > 0) ytext.delete(start, deleteCount);
  if (insert) ytext.insert(start, insert);
}

type UseCanvasCollabArgs = {
  conversationId: string;
  enabled: boolean;
  onDocChange: (next: { title: string; body: string }) => void;
};

export function useCanvasCollab({
  conversationId,
  enabled,
  onDocChange,
}: UseCanvasCollabArgs) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const { byUserId } = useDirectory();
  const { emit, emitAck, subscribe, connected } = useChatSocket();
  const [ready, setReady] = useState(false);
  const [peers, setPeers] = useState<CanvasPeerCursor[]>([]);
  const [liveCount, setLiveCount] = useState(1);
  const [syncError, setSyncError] = useState('');
  const docRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const applyingRemoteRef = useRef(false);
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;

  const publishLocalUpdate = useCallback(
    (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || origin === 'init') return;
      emit('chat:canvas_update', {
        conversationId,
        update: toBase64(update),
      });
    },
    [conversationId, emit],
  );

  useEffect(() => {
    if (!enabled || !userId || !connected) {
      setReady(false);
      return;
    }

    let cancelled = false;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    docRef.current = doc;
    awarenessRef.current = awareness;
    setSyncError('');
    setReady(false);

    const label =
      displayName(byUserId.get(userId)) ||
      session?.user.email ||
      'Teammate';
    awareness.setLocalStateField('user', {
      id: userId,
      name: label,
      color: colorForUser(userId),
    });

    const refreshPeers = () => {
      const next: CanvasPeerCursor[] = [];
      let count = 0;
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as
          | { id?: string; name?: string; color?: string }
          | undefined;
        if (!user?.id) return;
        count += 1;
        if (clientId === doc.clientID) return;
        const cursor = state.cursor as
          | { field?: string; anchor?: number; head?: number }
          | undefined;
        if (!cursor || (cursor.field !== 'title' && cursor.field !== 'body')) {
          return;
        }
        next.push({
          clientId,
          userId: user.id,
          name: user.name || 'Teammate',
          color: user.color || colorForUser(user.id),
          field: cursor.field,
          anchor: Number(cursor.anchor) || 0,
          head: Number(cursor.head) || 0,
        });
      });
      setPeers(next);
      setLiveCount(Math.max(1, count));
    };

    const onAwarenessChange = (
      {
        added,
        updated,
        removed,
      }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      refreshPeers();
      if (origin === 'remote') return;
      const changed = added.concat(updated, removed);
      if (!changed.length) return;
      const encoded = awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        changed,
      );
      emit('chat:canvas_awareness', {
        conversationId,
        update: toBase64(encoded),
      });
    };
    awareness.on('update', onAwarenessChange);

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || origin === 'init') return;
      publishLocalUpdate(update, origin);
      onDocChangeRef.current({
        title: doc.getText('title').toString(),
        body: doc.getText('body').toString(),
      });
    };
    doc.on('update', onUpdate);

    const unsubUpdate = subscribe('chat:canvas_update', (payload: unknown) => {
      const event = payload as {
        conversationId?: string;
        update?: string;
        actorId?: string;
      };
      if (event.conversationId !== conversationId || !event.update) return;
      if (event.actorId === userId) return;
      try {
        applyingRemoteRef.current = true;
        Y.applyUpdate(doc, fromBase64(event.update), 'remote');
        onDocChangeRef.current({
          title: doc.getText('title').toString(),
          body: doc.getText('body').toString(),
        });
      } catch {
        // ignore bad updates
      } finally {
        applyingRemoteRef.current = false;
      }
    });

    const unsubAwareness = subscribe(
      'chat:canvas_awareness',
      (payload: unknown) => {
        const event = payload as {
          conversationId?: string;
          update?: string;
          actorId?: string;
        };
        if (event.conversationId !== conversationId || !event.update) return;
        try {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            fromBase64(event.update),
            'remote',
          );
        } catch {
          // ignore
        }
      },
    );

    void emitAck<{
      status?: string;
      state?: string;
      title?: string;
      body?: string;
      message?: string;
    }>('chat:canvas_join', { conversationId }, 12_000)
      .then(
        (response: {
          status?: string;
          state?: string;
          title?: string;
          body?: string;
          message?: string;
        }) => {
          if (cancelled) return;
          if (response?.state) {
            Y.applyUpdate(doc, fromBase64(response.state), 'init');
          }
          onDocChangeRef.current({
            title: doc.getText('title').toString() || response?.title || '',
            body: doc.getText('body').toString() || response?.body || '',
          });
          setReady(true);
          refreshPeers();
        },
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setSyncError(
          err instanceof Error ? err.message : 'Could not join live canvas',
        );
        setReady(false);
      });

    return () => {
      cancelled = true;
      unsubUpdate();
      unsubAwareness();
      awareness.off('update', onAwarenessChange);
      doc.off('update', onUpdate);
      awareness.setLocalState(null);
      emit('chat:canvas_leave', { conversationId });
      awareness.destroy();
      doc.destroy();
      docRef.current = null;
      awarenessRef.current = null;
      setReady(false);
      setPeers([]);
      setLiveCount(1);
    };
  }, [
    byUserId,
    connected,
    conversationId,
    emit,
    emitAck,
    enabled,
    publishLocalUpdate,
    session?.user.email,
    subscribe,
    userId,
  ]);

  const setTitle = useCallback((value: string) => {
    const doc = docRef.current;
    if (!doc || applyingRemoteRef.current) return;
    const ytext = doc.getText('title');
    doc.transact(() => {
      applyYTextDiff(ytext, value.slice(0, 160));
    }, 'local');
  }, []);

  const setBody = useCallback((value: string) => {
    const doc = docRef.current;
    if (!doc || applyingRemoteRef.current) return;
    const ytext = doc.getText('body');
    doc.transact(() => {
      applyYTextDiff(ytext, value);
    }, 'local');
  }, []);

  const setLocalCursor = useCallback(
    (field: 'title' | 'body', anchor: number, head: number) => {
      const awareness = awarenessRef.current;
      if (!awareness) return;
      awareness.setLocalStateField('cursor', { field, anchor, head });
    },
    [],
  );

  return {
    ready,
    syncError,
    peers,
    liveCount,
    setTitle,
    setBody,
    setLocalCursor,
  };
}
