import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useConfirm } from '../../../components/ConfirmProvider';
import {
  useWhiteboardCollab,
  type WbNote,
  type WbStroke,
} from './useWhiteboardCollab';

const COLORS = [
  '#1f2937',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
  '#db2777',
];

const NOTE_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff'];

const WIDTHS = [2, 4, 8];

type Tool = 'pen' | 'eraser' | 'note' | 'select';

type Props = {
  conversationId: string;
};

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<WbStroke, 'color' | 'width' | 'tool' | 'points'>,
) {
  const pts = stroke.points;
  if (pts.length < 4) return;
  ctx.save();
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(pts[i], pts[i + 1]);
  }
  ctx.stroke();
  ctx.restore();
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `wb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function WhiteboardPanel({ conversationId }: Props) {
  const confirmDialog = useConfirm();
  const {
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
  } = useWhiteboardCollab({ conversationId, enabled: true });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef<number[] | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [dragNote, setDragNote] = useState<{
    id: string;
    ox: number;
    oy: number;
  } | null>(null);
  const [size, setSize] = useState({ w: 960, h: 560 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        w: Math.max(640, Math.floor(rect.width)),
        h: Math.max(420, Math.floor(rect.height)),
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.floor(size.w * dpr) ||
      canvas.height !== Math.floor(size.h * dpr)
    ) {
      canvas.width = Math.floor(size.w * dpr);
      canvas.height = Math.floor(size.h * dpr);
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // Dot grid
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    for (let x = 16; x < size.w; x += 24) {
      for (let y = 16; y < size.h; y += 24) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    for (const stroke of strokes) {
      drawStroke(ctx, stroke);
    }

    const localDraft = drawingRef.current;
    if (localDraft && localDraft.length >= 4) {
      drawStroke(ctx, {
        color,
        width: tool === 'eraser' ? Math.max(width * 3, 12) : width,
        tool: tool === 'eraser' ? 'eraser' : 'pen',
        points: localDraft,
      });
    }

    for (const peer of peers) {
      if (peer.stroke && peer.stroke.points.length >= 4) {
        drawStroke(ctx, peer.stroke);
      }
    }
  }, [color, peers, size.h, size.w, strokes, tool, width]);

  useEffect(() => {
    paint();
  }, [paint]);

  const toLocal = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(size.w, e.clientX - rect.left)),
      y: Math.max(0, Math.min(size.h, e.clientY - rect.top)),
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    const { x, y } = toLocal(e);
    setCursor(x, y);

    if (tool === 'note') {
      const id = newId();
      const note: WbNote = {
        id,
        x: x - 70,
        y: y - 40,
        text: '',
        color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
        userId,
      };
      upsertNote(note);
      setActiveNoteId(id);
      setTool('select');
      return;
    }

    if (tool === 'select') {
      setActiveNoteId(null);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = [x, y];
    setLiveStroke({
      color,
      width: tool === 'eraser' ? Math.max(width * 3, 12) : width,
      tool: tool === 'eraser' ? 'eraser' : 'pen',
      points: [x, y],
    });
    paint();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toLocal(e);
    setCursor(x, y);

    if (dragNote) {
      const note = notes.find((n) => n.id === dragNote.id);
      if (note) {
        upsertNote({
          ...note,
          x: x - dragNote.ox,
          y: y - dragNote.oy,
        });
      }
      return;
    }

    if (!drawingRef.current) return;
    const pts = drawingRef.current;
    const lastX = pts[pts.length - 2];
    const lastY = pts[pts.length - 1];
    if (Math.hypot(x - lastX, y - lastY) < 1.5) return;
    pts.push(x, y);
    setLiveStroke({
      color,
      width: tool === 'eraser' ? Math.max(width * 3, 12) : width,
      tool: tool === 'eraser' ? 'eraser' : 'pen',
      points: [...pts],
    });
    paint();
  };

  const finishStroke = () => {
    const pts = drawingRef.current;
    drawingRef.current = null;
    setLiveStroke(null);
    if (!pts || pts.length < 4) {
      paint();
      return;
    }
    addStroke({
      id: newId(),
      color,
      width: tool === 'eraser' ? Math.max(width * 3, 12) : width,
      tool: tool === 'eraser' ? 'eraser' : 'pen',
      points: pts,
    });
  };

  const onPointerUp = () => {
    if (dragNote) {
      setDragNote(null);
      return;
    }
    finishStroke();
  };

  const peerLabels = useMemo(
    () =>
      peers.map((p) => (
        <div
          key={p.clientId}
          className="wb-peer-cursor"
          style={{
            transform: `translate(${p.x}px, ${p.y}px)`,
            ['--wb-peer' as string]: p.color,
          }}
        >
          <span className="wb-peer-dot" />
          <span className="wb-peer-name">{p.name}</span>
        </div>
      )),
    [peers],
  );

  return (
    <div className="feature-panel whiteboard-panel">
      <div className="feature-panel-head">
        <div>
          <h3>Whiteboard</h3>
          <p>
            Live collaborative board — draw together, drop sticky notes, see
            teammate cursors in real time.
          </p>
        </div>
        <div className="wb-live-pill" title="People editing this board">
          <span className={`wb-live-dot${ready ? ' is-on' : ''}`} />
          {ready ? `${liveCount} live` : 'Connecting…'}
        </div>
      </div>

      {syncError ? (
        <div className="wb-banner is-error" role="alert">
          {syncError}
        </div>
      ) : null}

      <div className="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
        <div className="wb-tool-group">
          {(
            [
              ['pen', 'Pen'],
              ['eraser', 'Eraser'],
              ['note', 'Sticky'],
              ['select', 'Select'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`wb-tool${tool === id ? ' is-active' : ''}`}
              onClick={() => setTool(id)}
              aria-pressed={tool === id}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="wb-tool-group wb-colors" aria-label="Ink color">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`wb-swatch${color === c ? ' is-active' : ''}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => {
                setColor(c);
                setTool('pen');
              }}
            />
          ))}
        </div>
        <div className="wb-tool-group" aria-label="Brush size">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className={`wb-width${width === w ? ' is-active' : ''}`}
              onClick={() => setWidth(w)}
              aria-pressed={width === w}
            >
              <span style={{ width: w + 4, height: w + 4 }} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="wb-tool wb-danger"
          onClick={() => {
            void (async () => {
              const confirmed = await confirmDialog({
                title: 'Clear whiteboard?',
                message:
                  'This clears the entire board for everyone in this channel.',
                confirmLabel: 'Clear',
                cancelLabel: 'Cancel',
                danger: true,
              });
              if (confirmed) clearBoard();
            })();
          }}
        >
          Clear
        </button>
      </div>

      <div className="wb-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className={`wb-canvas tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setLiveStroke(null)}
        />
        <div className="wb-overlay" aria-hidden={false}>
          {peerLabels}
          {notes.map((note) => (
            <div
              key={note.id}
              className={`wb-sticky${activeNoteId === note.id ? ' is-active' : ''}`}
              style={{
                left: note.x,
                top: note.y,
                background: note.color,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setActiveNoteId(note.id);
                setTool('select');
                const rect = (
                  e.currentTarget as HTMLDivElement
                ).getBoundingClientRect();
                setDragNote({
                  id: note.id,
                  ox: e.clientX - rect.left,
                  oy: e.clientY - rect.top,
                });
                (e.currentTarget as HTMLDivElement).setPointerCapture(
                  e.pointerId,
                );
              }}
              onPointerMove={(e) => {
                if (!dragNote || dragNote.id !== note.id) return;
                const stage = stageRef.current?.getBoundingClientRect();
                if (!stage) return;
                upsertNote({
                  ...note,
                  x: e.clientX - stage.left - dragNote.ox,
                  y: e.clientY - stage.top - dragNote.oy,
                });
              }}
              onPointerUp={() => setDragNote(null)}
            >
              <textarea
                value={note.text}
                placeholder="Sticky note…"
                rows={4}
                onChange={(e) =>
                  upsertNote({ ...note, text: e.target.value.slice(0, 500) })
                }
                onPointerDown={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="wb-sticky-delete"
                aria-label="Delete sticky"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNote(note.id);
                  if (activeNoteId === note.id) setActiveNoteId(null);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
