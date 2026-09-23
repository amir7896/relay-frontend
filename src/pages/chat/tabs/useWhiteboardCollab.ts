import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import * as awarenessProtocol from 'y-protocols/awareness';
import { useAuth } from '../../../auth/AuthContext';
import { useChatSocket } from '../../../chat/ChatSocketContext';
import { displayName } from '../../../lib/format';
import { useDirectory } from '../../../people/useDirectory';

export type WbStroke = {
  id: string;
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
  points: number[];
  userId: string;
};

export type WbNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  userId: string;
};

export type WbPeerCursor = {
  clientId: number;
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  stroke?: { color: string; width: number; tool: 'pen' | 'eraser'; points: number[] };
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
  return `hsl(${hash % 360} 70% 45%)`;
}

function readStrokes(doc: Y.Doc): WbStroke[] {
  const arr = doc.getArray<WbStroke>('strokes');
  return arr.toArray().filter((s) => s && Array.isArray(s.points));
}

function readNotes(doc: Y.Doc): WbNote[] {
  const map = doc.getMap<WbNote>('notes');
  const out: WbNote[] = [];
  map.forEach((value) => {
    if (value && typeof value === 'object' && value.id) {
      out.push(value);
    }
  });
  return out;
}

type Args = {
  conversationId: string;
  enabled: boolean;
};

export function useWhiteboardCollab({ conversationId, enabled }: Args) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const { byUserId } = useDirectory();
  const { emit, emitAck, subscribe, connected } = useChatSocket();
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [strokes, setStrokes] = useState<WbStroke[]>([]);
  const [notes, setNotes] = useState<WbNote[]>([]);
  const [peers, setPeers] = useState<WbPeerCursor[]>([]);
  const [liveCount, setLiveCount] = useState(1);
  const docRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const revisionRef = useRef(0);
  const [, bump] = useState(0);

  const refreshDoc = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    setStrokes(readStrokes(doc));
    setNotes(readNotes(doc));
    revisionRef.current += 1;
    bump((n) => n + 1);
  }, []);

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
      const next: WbPeerCursor[] = [];
      let count = 0;
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as
          | { id?: string; name?: string; color?: string }
          | undefined;
        if (!user?.id) return;
        count += 1;
        if (clientId === doc.clientID) return;
        const cursor = state.cursor as { x?: number; y?: number } | undefined;
        const stroke = state.stroke as WbPeerCursor['stroke'] | undefined;
        next.push({
          clientId,
          userId: user.id,
          name: user.name || 'Teammate',
          color: user.color || colorForUser(user.id),
          x: Number(cursor?.x) || 0,
          y: Number(cursor?.y) || 0,
          stroke,
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
      emit('chat:whiteboard_awareness', {
        conversationId,
        update: toBase64(encoded),
      });
    };
    awareness.on('update', onAwarenessChange);

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || origin === 'init') return;
      emit('chat:whiteboard_update', {
        conversationId,
        update: toBase64(update),
      });
      refreshDoc();
    };
    doc.on('update', onUpdate);

    const unsubUpdate = subscribe(
      'chat:whiteboard_update',
      (payload: unknown) => {
        const event = payload as {
          conversationId?: string;
          update?: string;
          actorId?: string;
        };
        if (event.conversationId !== conversationId || !event.update) return;
        if (event.actorId === userId) return;
        try {
          Y.applyUpdate(doc, fromBase64(event.update), 'remote');
          refreshDoc();
        } catch {
          // ignore
        }
      },
    );

    const unsubAwareness = subscribe(
      'chat:whiteboard_awareness',
      (payload: unknown) => {
        const event = payload as {
          conversationId?: string;
          update?: string;
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

    void emitAck<{ status?: string; state?: string; message?: string }>(
      'chat:whiteboard_join',
      { conversationId },
      12_000,
    )
      .then((response) => {
        if (cancelled) return;
        if (response?.state) {
          Y.applyUpdate(doc, fromBase64(response.state), 'init');
        }
        refreshDoc();
        setReady(true);
        refreshPeers();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSyncError(
          err instanceof Error
            ? err.message
            : 'Could not join live whiteboard',
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
      emit('chat:whiteboard_leave', { conversationId });
      awareness.destroy();
      doc.destroy();
      docRef.current = null;
      awarenessRef.current = null;
      setReady(false);
      setPeers([]);
      setStrokes([]);
      setNotes([]);
      setLiveCount(1);
    };
  }, [
    byUserId,
    connected,
    conversationId,
    emit,
    emitAck,
    enabled,
    refreshDoc,
    session?.user.email,
    subscribe,
    userId,
  ]);

  const addStroke = useCallback(
    (stroke: Omit<WbStroke, 'userId'>) => {
      const doc = docRef.current;
      if (!doc) return;
      doc.transact(() => {
        doc.getArray<WbStroke>('strokes').push([
          {
            ...stroke,
            userId,
          },
        ]);
      }, 'local');
    },
    [userId],
  );

  const clearBoard = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.transact(() => {
      const strokesArr = doc.getArray('strokes');
      if (strokesArr.length) strokesArr.delete(0, strokesArr.length);
      const notesMap = doc.getMap('notes');
      Array.from(notesMap.keys()).forEach((key) => notesMap.delete(key));
    }, 'local');
  }, []);

  const upsertNote = useCallback(
    (note: Omit<WbNote, 'userId'> & { userId?: string }) => {
      const doc = docRef.current;
      if (!doc) return;
      doc.transact(() => {
        doc.getMap<WbNote>('notes').set(note.id, {
          ...note,
          userId: note.userId || userId,
        });
      }, 'local');
    },
    [userId],
  );

  const deleteNote = useCallback((noteId: string) => {
    const doc = docRef.current;
    if (!doc) return;
    doc.transact(() => {
      doc.getMap('notes').delete(noteId);
    }, 'local');
  }, []);

  const setCursor = useCallback((x: number, y: number) => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    awareness.setLocalStateField('cursor', { x, y });
  }, []);

  const setLiveStroke = useCallback(
    (
      stroke:
        | { color: string; width: number; tool: 'pen' | 'eraser'; points: number[] }
        | null,
    ) => {
      const awareness = awarenessRef.current;
      if (!awareness) return;
      awareness.setLocalStateField('stroke', stroke);
    },
    [],
  );

  return {
    ready,
    syncError,
    strokes,
    notes,
    peers,
    liveCount,
    userId,
    addStroke,
    clearBoard,
    upsertNote,
    deleteNote,
    setCursor,
    setLiveStroke,
  };
}
