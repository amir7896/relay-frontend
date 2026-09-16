import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useChatSocket } from '../../../chat/ChatSocketContext';
import type { ConversationCanvas } from '../../../api/types';

const EMPTY_CANVAS: ConversationCanvas = {
  id: '',
  organizationId: '',
  conversationId: '',
  title: '',
  body: '',
  updatedBy: '',
  createdAt: '',
  updatedAt: null,
};

function normalizeCanvas(
  value: ConversationCanvas | null | undefined,
  conversationId: string,
): ConversationCanvas {
  if (!value || typeof value !== 'object') {
    return { ...EMPTY_CANVAS, conversationId };
  }
  return {
    id: value.id ?? '',
    organizationId: value.organizationId ?? '',
    conversationId: value.conversationId || conversationId,
    title: value.title ?? '',
    body: value.body ?? '',
    updatedBy: value.updatedBy ?? '',
    createdAt: value.createdAt ?? '',
    updatedAt: value.updatedAt ?? null,
  };
}

export function CanvasPanel({ conversationId }: { conversationId: string }) {
  const { session } = useAuth();
  const { subscribe } = useChatSocket();
  const userId = session?.user.id;
  const [canvas, setCanvas] = useState<ConversationCanvas>(() =>
    normalizeCanvas(null, conversationId),
  );
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const dirtyRef = useRef(false);
  const skipRemoteRef = useRef(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    let active = true;
    dirtyRef.current = false;
    loadedRef.current = false;
    setLoading(true);
    setStatus('');
    setCanvas(normalizeCanvas(null, conversationId));
    api<ConversationCanvas | null>(`/chat/conversations/${conversationId}/canvas`)
      .then((response) => {
        if (!active) return;
        dirtyRef.current = false;
        setCanvas(normalizeCanvas(response.data, conversationId));
      })
      .catch(() => {
        if (active) setStatus('Canvas is not available yet.');
      })
      .finally(() => {
        if (active) {
          loadedRef.current = true;
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId]);

  useEffect(() => {
    return subscribe('chat:canvas', (payload) => {
      const next = normalizeCanvas(payload as ConversationCanvas, conversationId);
      if (next.conversationId !== conversationId) return;
      if (skipRemoteRef.current && next.updatedBy === userId) return;
      if (dirtyRef.current && next.updatedBy === userId) {
        setCanvas((current) => ({
          ...current,
          id: next.id || current.id,
          updatedAt: next.updatedAt,
          updatedBy: next.updatedBy,
        }));
        return;
      }
      if (dirtyRef.current) return;
      setCanvas(next);
      setStatus('Updated live');
    });
  }, [conversationId, subscribe, userId]);

  useEffect(() => {
    if (!loadedRef.current || loading || !dirtyRef.current) return;
    setStatus('Saving…');
    const timer = window.setTimeout(() => {
      skipRemoteRef.current = true;
      api<ConversationCanvas>(`/chat/conversations/${conversationId}/canvas`, {
        method: 'PUT',
        body: JSON.stringify({ title: canvas.title, body: canvas.body }),
      })
        .then((response) => {
          const saved = normalizeCanvas(response.data, conversationId);
          dirtyRef.current = false;
          setCanvas((current) => ({
            ...current,
            ...saved,
            title: current.title,
            body: current.body,
          }));
          setStatus('Saved');
        })
        .catch(() => setStatus('Could not save changes.'))
        .finally(() => {
          window.setTimeout(() => {
            skipRemoteRef.current = false;
          }, 400);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [canvas.title, canvas.body, conversationId, loading]);

  function updateField(field: 'title' | 'body', value: string) {
    dirtyRef.current = true;
    setCanvas((current) => ({ ...current, [field]: value }));
  }

  if (loading) return <p className="muted tab-empty">Loading canvas…</p>;

  return (
    <section className="feature-panel canvas-panel">
      <div className="feature-panel-head">
        <div>
          <h3>Canvas</h3>
          <p className="muted">
            Collaborative notes for this channel. Everyone here can edit.
          </p>
        </div>
        <small className="muted" role="status">
          {status}
        </small>
      </div>
      <input
        className="canvas-title"
        value={canvas.title}
        onChange={(event) => updateField('title', event.target.value)}
        placeholder="Untitled canvas"
        aria-label="Canvas title"
      />
      <textarea
        className="canvas-body"
        value={canvas.body}
        onChange={(event) => updateField('body', event.target.value)}
        placeholder="Add notes, decisions, links, and channel context…"
        aria-label="Canvas content"
      />
    </section>
  );
}
