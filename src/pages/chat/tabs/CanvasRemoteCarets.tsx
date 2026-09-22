import { useLayoutEffect, useState, type RefObject } from 'react';
import type { CanvasPeerCursor } from './useCanvasCollab';

type CaretPos = {
  clientId: number;
  name: string;
  color: string;
  top: number;
  left: number;
  height: number;
  width: number;
};

function copyInputStyles(
  source: HTMLTextAreaElement | HTMLInputElement,
  target: HTMLElement,
) {
  const style = window.getComputedStyle(source);
  const props = [
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
    'MozTabSize',
    'whiteSpace',
    'wordBreak',
    'overflowWrap',
  ] as const;
  for (const prop of props) {
    target.style.setProperty(prop, style.getPropertyValue(prop));
  }
  target.style.position = 'absolute';
  target.style.visibility = 'hidden';
  target.style.pointerEvents = 'none';
  target.style.top = '0';
  target.style.left = '-9999px';
  if (source instanceof HTMLTextAreaElement) {
    target.style.whiteSpace = 'pre-wrap';
    target.style.wordWrap = 'break-word';
    target.style.width = `${source.clientWidth}px`;
    target.style.height = `${source.clientHeight}px`;
  } else {
    target.style.whiteSpace = 'pre';
    target.style.overflow = 'hidden';
    target.style.width = `${source.clientWidth}px`;
    target.style.height = `${source.clientHeight}px`;
  }
}

/** Map a character index in an input/textarea to pixel coords inside the control. */
export function measureCaretInField(
  el: HTMLTextAreaElement | HTMLInputElement,
  index: number,
): { top: number; left: number; height: number } | null {
  if (typeof document === 'undefined') return null;
  const clamped = Math.max(0, Math.min(index, el.value.length));
  const mirror = document.createElement('div');
  copyInputStyles(el, mirror);
  const style = window.getComputedStyle(el);
  const before = el.value.slice(0, clamped);
  // Preserve trailing newline so caret sits on the next line.
  mirror.textContent = before.endsWith('\n') ? `${before}\u200b` : before;
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  mirror.scrollTop = el.scrollTop;
  mirror.scrollLeft = el.scrollLeft;

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const lineHeight =
    Number.parseFloat(style.lineHeight) ||
    markerRect.height ||
    Number.parseFloat(style.fontSize) ||
    16;

  const top = markerRect.top - mirrorRect.top + borderTop - el.scrollTop;
  const left = markerRect.left - mirrorRect.left + borderLeft - el.scrollLeft;
  document.body.removeChild(mirror);

  return {
    top: Math.max(0, top),
    left: Math.max(0, left),
    height: lineHeight,
  };
}

type Props = {
  field: 'title' | 'body';
  fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  peers: CanvasPeerCursor[];
  /** Recompute when text/layout changes. */
  text: string;
};

export function CanvasRemoteCarets({ field, fieldRef, peers, text }: Props) {
  const [positions, setPositions] = useState<CaretPos[]>([]);

  useLayoutEffect(() => {
    const el = fieldRef.current;
    const fieldPeers = peers.filter((peer) => peer.field === field);
    if (!el || fieldPeers.length === 0) {
      setPositions([]);
      return;
    }

    const recompute = () => {
      const next: CaretPos[] = [];
      for (const peer of fieldPeers) {
        const head = Math.max(
          0,
          Math.min(Math.max(peer.anchor, peer.head), el.value.length),
        );
        const anchor = Math.max(
          0,
          Math.min(Math.min(peer.anchor, peer.head), el.value.length),
        );
        const headPos = measureCaretInField(el, head);
        if (!headPos) continue;
        let width = 2;
        let left = headPos.left;
        if (anchor !== head) {
          const anchorPos = measureCaretInField(el, anchor);
          if (anchorPos && Math.abs(anchorPos.top - headPos.top) < 2) {
            width = Math.max(2, Math.abs(headPos.left - anchorPos.left));
            left = Math.min(headPos.left, anchorPos.left);
          }
        }
        // Keep caret inside the visible editor box.
        if (
          headPos.top > el.clientHeight + 8 ||
          left > el.clientWidth + 8 ||
          headPos.top + headPos.height < -8
        ) {
          continue;
        }
        next.push({
          clientId: peer.clientId,
          name: peer.name,
          color: peer.color,
          top: headPos.top,
          left,
          height: headPos.height,
          width,
        });
      }
      setPositions(next);
    };

    recompute();
    el.addEventListener('scroll', recompute);
    window.addEventListener('resize', recompute);
    return () => {
      el.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [field, fieldRef, peers, text]);

  if (positions.length === 0) return null;

  return (
    <div className="canvas-caret-layer" aria-hidden="true">
      {positions.map((pos) => (
        <div
          key={pos.clientId}
          className={`canvas-remote-caret${pos.width > 2 ? ' has-range' : ''}`}
          style={{
            top: pos.top,
            left: pos.left,
            height: pos.height,
            width: pos.width,
            ['--peer-color' as string]: pos.color,
          }}
        >
          <span className="canvas-remote-caret-label">{pos.name}</span>
        </div>
      ))}
    </div>
  );
}
