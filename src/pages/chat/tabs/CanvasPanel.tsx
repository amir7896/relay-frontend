import { useDirectory } from '../../../people/useDirectory';
import { displayName } from '../../../lib/format';
import type {
  Conversation,
  ConversationCanvas,
  CanvasComment,
  LinkPreview,
  MessageAttachment,
} from '../../../api/types';
import {
  insertComposerText,
  mentionHandle,
  parseCanvasBody,
  parseMentionQuery,
  prefixComposerLines,
  collectCanvasLinkUrls,
  renderMessageBody,
  serializeFileEmbed,
  serializeLinkEmbed,
  wrapComposerSelection,
  type FormatMarker,
  type MessageBodyPart,
} from '../../../lib/chatComposer';
import { useAuth } from '../../../auth/AuthContext';
import { useChatSocket } from '../../../chat/ChatSocketContext';
import { api } from '../../../api/client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

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

function fileExtLabel(name: string, mime: string) {
  const fromName = name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1).toUpperCase()
    : '';
  if (fromName && fromName.length <= 5) return fromName;
  if (mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('image/')) return 'IMG';
  if (mime.startsWith('video/')) return 'VID';
  if (mime.startsWith('audio/')) return 'AUD';
  return 'FILE';
}

function CanvasRichText({
  text,
  mentionLabels,
  selfId,
}: {
  text: string;
  mentionLabels: Map<string, string>;
  selfId?: string;
}) {
  const parts = renderMessageBody(text, mentionLabels);
  return (
    <>
      {parts.map((part: MessageBodyPart, index) => {
        const key = `c-${index}`;
        if (part.type === 'mention') {
          const isYou =
            Boolean(selfId) &&
            (part.userId === selfId ||
              part.special === 'channel' ||
              part.special === 'here');
          const label =
            part.special === 'channel'
              ? '@channel'
              : part.special === 'here'
                ? '@here'
                : part.value;
          return (
            <mark
              key={key}
              className={`wa-mention${isYou ? ' wa-mention-you' : ''}${
                part.special ? ` wa-mention-${part.special}` : ''
              }`}
            >
              {label}
            </mark>
          );
        }
        if (part.type === 'bold') return <strong key={key}>{part.value}</strong>;
        if (part.type === 'italic') return <em key={key}>{part.value}</em>;
        if (part.type === 'strike') return <s key={key}>{part.value}</s>;
        if (part.type === 'code') {
          return (
            <code key={key} className="wa-msg-code">
              {part.value}
            </code>
          );
        }
        if (part.type === 'link') {
          return (
            <a
              key={key}
              className="wa-msg-link"
              href={part.href || part.value}
              target="_blank"
              rel="noreferrer"
            >
              {part.value}
            </a>
          );
        }
        return <span key={key}>{part.value}</span>;
      })}
    </>
  );
}

export function CanvasPanel({ conversationId }: { conversationId: string }) {
  const { session } = useAuth();
  const { subscribe } = useChatSocket();
  const { byUserId, ensureProfiles } = useDirectory();
  const userId = session?.user.id;
  const [canvas, setCanvas] = useState<ConversationCanvas>(() =>
    normalizeCanvas(null, conversationId),
  );
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [mentionQuery, setMentionQuery] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [linkCards, setLinkCards] = useState<LinkPreview[]>([]);
  const [embedBusy, setEmbedBusy] = useState(false);
  const [members, setMembers] = useState<{ userId: string; label: string }[]>(
    [],
  );
  const [comments, setComments] = useState<CanvasComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentAnchor, setCommentAnchor] = useState('');
  const [commentsBusy, setCommentsBusy] = useState(false);
  const dirtyRef = useRef(false);
  const skipRemoteRef = useRef(false);
  const loadedRef = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const mentionLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.label);
    }
    return map;
  }, [members]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query;
    return members
      .filter((member) => {
        const handle = mentionHandle(member.label);
        return (
          !q ||
          handle.includes(q) ||
          member.label.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [members, mentionQuery]);

  const blocks = useMemo(
    () => parseCanvasBody(canvas.body),
    [canvas.body],
  );

  useEffect(() => {
    let active = true;
    dirtyRef.current = false;
    loadedRef.current = false;
    setLoading(true);
    setStatus('');
    setMode('edit');
    setMentionQuery(null);
    setLinkCards([]);
    setComments([]);
    setCommentDraft('');
    setCommentAnchor('');
    setCanvas(normalizeCanvas(null, conversationId));
    Promise.all([
      api<ConversationCanvas | null>(
        `/chat/conversations/${conversationId}/canvas`,
      ),
      api<Conversation>(`/chat/conversations/${conversationId}`),
      api<CanvasComment[]>(
        `/chat/conversations/${conversationId}/canvas/comments`,
      ).catch(() => ({ data: [] as CanvasComment[] })),
    ])
      .then(([canvasRes, convRes, commentsRes]) => {
        if (!active) return;
        dirtyRef.current = false;
        setCanvas(normalizeCanvas(canvasRes.data, conversationId));
        setComments(Array.isArray(commentsRes.data) ? commentsRes.data : []);
        const nextMembers = (convRes.data?.members ?? []).map((member) => ({
          userId: member.userId,
          label: displayName(byUserId.get(member.userId)),
        }));
        setMembers(nextMembers);
        void ensureProfiles([
          ...nextMembers.map((m) => m.userId),
          ...(commentsRes.data ?? []).map((c) => c.authorId),
        ]);
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
  }, [conversationId, ensureProfiles]);

  useEffect(() => {
    setMembers((current) => {
      if (!current.length) return current;
      let changed = false;
      const next = current.map((member) => {
        const label = displayName(byUserId.get(member.userId));
        if (label !== member.label) changed = true;
        return { ...member, label };
      });
      return changed ? next : current;
    });
  }, [byUserId]);

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

  useEffect(() => {
    if (mode !== 'preview' || !canvas.body.trim()) {
      setLinkCards([]);
      return;
    }
    let cancelled = false;
    const urls = collectCanvasLinkUrls(canvas.body);
    if (!urls.length) {
      setLinkCards([]);
      return;
    }
    void Promise.all(
      urls.map((url) =>
        api<LinkPreview>('/chat/link-preview', {
          method: 'POST',
          body: JSON.stringify({ url }),
        })
          .then((res) => res.data)
          .catch(() => null),
      ),
    ).then((cards) => {
      if (cancelled) return;
      setLinkCards(cards.filter(Boolean) as LinkPreview[]);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, canvas.body]);

  function updateField(field: 'title' | 'body', value: string) {
    dirtyRef.current = true;
    setCanvas((current) => ({ ...current, [field]: value }));
  }

  function applyBodyEdit(
    next: { value: string; selectionStart: number; selectionEnd: number },
  ) {
    updateField('body', next.value);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  function formatSelection(marker: FormatMarker) {
    const el = bodyRef.current;
    if (!el) return;
    applyBodyEdit(
      wrapComposerSelection(
        canvas.body,
        el.selectionStart,
        el.selectionEnd,
        marker,
      ),
    );
  }

  function formatLine(prefix: string) {
    const el = bodyRef.current;
    if (!el) return;
    applyBodyEdit(
      prefixComposerLines(
        canvas.body,
        el.selectionStart,
        el.selectionEnd,
        prefix,
      ),
    );
  }

  function insertSnippet(snippet: string) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? canvas.body.length;
    const end = el?.selectionEnd ?? start;
    applyBodyEdit(insertComposerText(canvas.body, start, end, snippet));
  }

  function onBodyChange(value: string) {
    updateField('body', value);
    const el = bodyRef.current;
    if (!el) {
      setMentionQuery(null);
      return;
    }
    const before = value.slice(0, el.selectionStart);
    setMentionQuery(parseMentionQuery(before));
  }

  function insertMention(member: { userId: string; label: string }) {
    if (!mentionQuery) return;
    const handle = mentionHandle(member.label) || 'user';
    const before = canvas.body.slice(0, mentionQuery.start);
    const el = bodyRef.current;
    const caret = el?.selectionStart ?? canvas.body.length;
    const after = canvas.body.slice(caret);
    const next = `${before}@${handle} ${after}`;
    updateField('body', next);
    setMentionQuery(null);
    const pos = before.length + handle.length + 2;
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(pos, pos);
    });
  }

  function onBodyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery && mentionSuggestions.length) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mentionSuggestions[0]);
        return;
      }
    }
    if (event.key === 'b' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      formatSelection('*');
    } else if (event.key === 'i' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      formatSelection('_');
    }
  }

  async function embedLink() {
    const raw = window.prompt('Paste a link to embed');
    const url = raw?.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setStatus('Link must start with http:// or https://');
      return;
    }
    setEmbedBusy(true);
    try {
      await api<LinkPreview>('/chat/link-preview', {
        method: 'POST',
        body: JSON.stringify({ url }),
      }).catch(() => null);
      insertSnippet(serializeLinkEmbed(url));
      setStatus('Link embed added');
    } finally {
      setEmbedBusy(false);
    }
  }

  async function onFileSelected(file: File | null) {
    if (!file) return;
    setEmbedBusy(true);
    setStatus('Uploading…');
    try {
      const form = new FormData();
      form.append('file', file);
      const upload = await api<MessageAttachment>('/chat/uploads', {
        method: 'POST',
        body: form,
      });
      insertSnippet(
        serializeFileEmbed({
          name: upload.data.name || file.name,
          url: upload.data.url,
          mime: upload.data.mime || file.type,
        }),
      );
      setStatus('File embed added');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setEmbedBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function captureAnchorFromSelection() {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const selected = el.value.slice(start, end).trim();
    if (selected) {
      setCommentAnchor(selected.slice(0, 240));
      return;
    }
    const lineStart = el.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEnd = el.value.indexOf('\n', start);
    const line = el.value
      .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
      .trim();
    setCommentAnchor(line.slice(0, 240));
  }

  async function submitComment() {
    const body = commentDraft.trim();
    if (!body) return;
    setCommentsBusy(true);
    try {
      const response = await api<CanvasComment>(
        `/chat/conversations/${conversationId}/canvas/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            body,
            anchorText: commentAnchor.trim(),
            anchorOffset: 0,
          }),
        },
      );
      setComments((current) => [response.data, ...current]);
      setCommentDraft('');
      void ensureProfiles([response.data.authorId]);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not add comment');
    } finally {
      setCommentsBusy(false);
    }
  }

  async function toggleResolveComment(comment: CanvasComment) {
    try {
      const response = await api<CanvasComment>(
        `/chat/conversations/${conversationId}/canvas/comments/${comment.id}/resolve`,
        { method: 'POST' },
      );
      setComments((current) =>
        current.map((item) =>
          item.id === comment.id ? response.data : item,
        ),
      );
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : 'Could not update comment',
      );
    }
  }

  async function removeComment(comment: CanvasComment) {
    try {
      await api(
        `/chat/conversations/${conversationId}/canvas/comments/${comment.id}`,
        { method: 'DELETE' },
      );
      setComments((current) =>
        current.filter((item) => item.id !== comment.id),
      );
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : 'Could not delete comment',
      );
    }
  }

  if (loading) return <p className="muted tab-empty">Loading canvas…</p>;

  const openComments = comments.filter((c) => !c.resolvedAt);
  const resolvedComments = comments.filter((c) => c.resolvedAt);

  return (
    <section className="feature-panel canvas-panel canvas-panel-with-comments">
      <div className="canvas-main">
      <div className="feature-panel-head">
        <div>
          <h3>Canvas</h3>
          <p className="muted">
            Shared work surface — markdown, @mentions, links, files, and section
            comments.
          </p>
        </div>
        <div className="canvas-head-actions">
          <div className="canvas-mode-toggle" role="tablist" aria-label="Canvas mode">
            <button
              type="button"
              className={mode === 'edit' ? 'on' : ''}
              role="tab"
              aria-selected={mode === 'edit'}
              onClick={() => setMode('edit')}
            >
              Edit
            </button>
            <button
              type="button"
              className={mode === 'preview' ? 'on' : ''}
              role="tab"
              aria-selected={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              Preview
            </button>
          </div>
          <small className="muted" role="status">
            {status}
          </small>
        </div>
      </div>

      <input
        className="canvas-title"
        value={canvas.title}
        onChange={(event) => updateField('title', event.target.value)}
        placeholder="Untitled canvas"
        aria-label="Canvas title"
      />

      {mode === 'edit' ? (
        <>
          <div className="canvas-toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" title="Bold" onClick={() => formatSelection('*')}>
              <strong>B</strong>
            </button>
            <button type="button" title="Italic" onClick={() => formatSelection('_')}>
              <em>I</em>
            </button>
            <button type="button" title="Strikethrough" onClick={() => formatSelection('~')}>
              <s>S</s>
            </button>
            <button type="button" title="Code" onClick={() => formatSelection('`')}>
              {'</>'}
            </button>
            <span className="canvas-toolbar-sep" aria-hidden="true" />
            <button type="button" title="Heading" onClick={() => formatLine('# ')}>
              H
            </button>
            <button type="button" title="Bullet list" onClick={() => formatLine('- ')}>
              •
            </button>
            <button
              type="button"
              title="Divider"
              onClick={() => insertSnippet('---')}
            >
              ―
            </button>
            <span className="canvas-toolbar-sep" aria-hidden="true" />
            <button
              type="button"
              title="Insert @"
              onClick={() => {
                const el = bodyRef.current;
                const start = el?.selectionStart ?? canvas.body.length;
                const end = el?.selectionEnd ?? start;
                const value = `${canvas.body.slice(0, start)}@${canvas.body.slice(end)}`;
                updateField('body', value);
                setMentionQuery({ query: '', start });
                requestAnimationFrame(() => {
                  bodyRef.current?.focus();
                  bodyRef.current?.setSelectionRange(start + 1, start + 1);
                });
              }}
            >
              @
            </button>
            <button
              type="button"
              title="Embed link"
              disabled={embedBusy}
              onClick={() => void embedLink()}
            >
              Link
            </button>
            <button
              type="button"
              title="Attach file"
              disabled={embedBusy}
              onClick={() => fileRef.current?.click()}
            >
              File
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(event) =>
                void onFileSelected(event.target.files?.[0] ?? null)
              }
            />
          </div>

          <div className="canvas-editor-wrap">
            <textarea
              ref={bodyRef}
              className="canvas-body"
              value={canvas.body}
              onChange={(event) => onBodyChange(event.target.value)}
              onKeyUp={(event) =>
                onBodyChange((event.target as HTMLTextAreaElement).value)
              }
              onClick={(event) =>
                onBodyChange((event.target as HTMLTextAreaElement).value)
              }
              onKeyDown={onBodyKeyDown}
              placeholder={
                'Write notes with *bold*, _italic_, # headings, - bullets…\n' +
                'Type @ to mention someone. Use Link / File to embed.'
              }
              aria-label="Canvas content"
            />
            {mentionQuery && mentionSuggestions.length ? (
              <ul className="canvas-mention-picker mention-picker" role="listbox">
                {mentionSuggestions.map((member) => (
                  <li key={member.userId}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertMention(member);
                      }}
                    >
                      {member.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="muted canvas-hint">
            Tip: Cmd/Ctrl+B bold · Cmd/Ctrl+I italic · Preview to see embeds
          </p>
        </>
      ) : (
        <div className="canvas-preview">
          {!canvas.body.trim() ? (
            <p className="muted tab-empty">Nothing to preview yet — switch to Edit.</p>
          ) : (
            <>
              {blocks.map((block, index) => {
                const key = `b-${index}`;
                if (block.type === 'heading') {
                  const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3');
                  return (
                    <Tag key={key} className={`canvas-h canvas-h${block.level}`}>
                      <CanvasRichText
                        text={block.text}
                        mentionLabels={mentionLabels}
                        selfId={userId}
                      />
                    </Tag>
                  );
                }
                if (block.type === 'bullet') {
                  return (
                    <div key={key} className="canvas-bullet">
                      <span aria-hidden="true">•</span>
                      <span>
                        <CanvasRichText
                          text={block.text}
                          mentionLabels={mentionLabels}
                          selfId={userId}
                        />
                      </span>
                    </div>
                  );
                }
                if (block.type === 'divider') {
                  return <hr key={key} className="canvas-divider" />;
                }
                if (block.type === 'linkEmbed') {
                  const card = linkCards.find((item) => item.url === block.url);
                  return (
                    <a
                      key={key}
                      className="link-preview-card canvas-embed-card"
                      href={block.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {card?.image ? (
                        <img src={card.image} alt="" loading="lazy" />
                      ) : null}
                      <span>
                        <strong>{card?.title || block.url}</strong>
                        <small>{card?.description || block.url}</small>
                      </span>
                    </a>
                  );
                }
                if (block.type === 'fileEmbed') {
                  return (
                    <a
                      key={key}
                      className="wa-file-card canvas-file-card"
                      href={block.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="wa-file-icon" aria-hidden="true">
                        {fileExtLabel(block.name, block.mime)}
                      </span>
                      <span className="wa-file-meta">
                        <strong className="wa-file-name">{block.name}</strong>
                        <small className="wa-file-sub">{block.mime || 'Attachment'}</small>
                      </span>
                    </a>
                  );
                }
                return (
                  <p key={key} className="canvas-paragraph">
                    <CanvasRichText
                      text={block.text}
                      mentionLabels={mentionLabels}
                      selfId={userId}
                    />
                  </p>
                );
              })}
              {linkCards
                .filter(
                  (card) =>
                    !blocks.some(
                      (block) =>
                        block.type === 'linkEmbed' && block.url === card.url,
                    ),
                )
                .map((card) => (
                  <a
                    key={card.url}
                    className="link-preview-card canvas-embed-card"
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {card.image ? (
                      <img src={card.image} alt="" loading="lazy" />
                    ) : null}
                    <span>
                      <strong>{card.title || card.url}</strong>
                      <small>{card.description || card.url}</small>
                    </span>
                  </a>
                ))}
            </>
          )}
        </div>
      )}
      </div>

      <aside className="canvas-comments" aria-label="Canvas comments">
        <div className="canvas-comments-head">
          <h4>Comments</h4>
          <p className="muted">Anchor notes to a selected line or section.</p>
        </div>
        <div className="canvas-comment-composer">
          <input
            type="text"
            value={commentAnchor}
            onChange={(event) => setCommentAnchor(event.target.value)}
            placeholder="Anchor text (optional)"
            maxLength={240}
          />
          <textarea
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder="Add a comment…"
            rows={3}
            maxLength={2000}
          />
          <div className="canvas-comment-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => captureAnchorFromSelection()}
            >
              Use selection
            </button>
            <button
              type="button"
              className="primary"
              disabled={commentsBusy || !commentDraft.trim()}
              onClick={() => void submitComment()}
            >
              Comment
            </button>
          </div>
        </div>
        {openComments.length === 0 && resolvedComments.length === 0 ? (
          <p className="muted">No comments yet.</p>
        ) : null}
        <ul className="canvas-comment-list">
          {openComments.map((comment) => {
            const author = displayName(byUserId.get(comment.authorId));
            return (
              <li key={comment.id} className="canvas-comment-item">
                {comment.anchorText ? (
                  <blockquote className="canvas-comment-anchor">
                    {comment.anchorText}
                  </blockquote>
                ) : null}
                <p>{comment.body}</p>
                <div className="canvas-comment-meta">
                  <small className="muted">{author}</small>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void toggleResolveComment(comment)}
                  >
                    Resolve
                  </button>
                  {comment.authorId === userId ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void removeComment(comment)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {resolvedComments.length > 0 ? (
          <details className="canvas-resolved-comments">
            <summary>Resolved ({resolvedComments.length})</summary>
            <ul className="canvas-comment-list">
              {resolvedComments.map((comment) => {
                const author = displayName(byUserId.get(comment.authorId));
                return (
                  <li
                    key={comment.id}
                    className="canvas-comment-item is-resolved"
                  >
                    {comment.anchorText ? (
                      <blockquote className="canvas-comment-anchor">
                        {comment.anchorText}
                      </blockquote>
                    ) : null}
                    <p>{comment.body}</p>
                    <div className="canvas-comment-meta">
                      <small className="muted">{author}</small>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void toggleResolveComment(comment)}
                      >
                        Reopen
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </aside>
    </section>
  );
}
