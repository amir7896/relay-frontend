import {
  KeyboardEvent,
  TextareaHTMLAttributes,
  useEffect,
  useRef,
} from 'react';
import {
  FormatMarker,
  insertComposerText,
  prefixComposerLines,
  wrapComposerSelection,
} from '../lib/chatComposer';

type EditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> & {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string | null;
  /** Called when Ctrl/⌘+Enter is pressed (e.g. submit reply). */
  onModEnter?: () => void;
};

function applyEdit(
  el: HTMLTextAreaElement | null,
  value: string,
  onChange: (value: string) => void,
  result: EditResult,
) {
  onChange(result.value);
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(result.selectionStart, result.selectionEnd);
  });
}

export function MrkdwnEditor({
  value,
  onChange,
  label,
  hint = 'Slack-style: *bold* _italic_ ~strike~ `code` · one question per line',
  onModEnter,
  className = '',
  rows = 5,
  onKeyDown,
  ...textareaProps
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<EditResult | null>(null);

  useEffect(() => {
    const pending = pendingSelection.current;
    const el = ref.current;
    if (!pending || !el) return;
    if (el.value !== pending.value) return;
    el.setSelectionRange(pending.selectionStart, pending.selectionEnd);
    pendingSelection.current = null;
  }, [value]);

  function run(edit: (start: number, end: number) => EditResult) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const result = edit(start, end);
    pendingSelection.current = result;
    applyEdit(el, value, onChange, result);
  }

  function wrap(marker: FormatMarker, placeholder?: string) {
    run((start, end) =>
      wrapComposerSelection(value, start, end, marker, placeholder),
    );
  }

  function prefix(marker: string) {
    run((start, end) => prefixComposerLines(value, start, end, marker));
  }

  function insert(snippet: string) {
    run((start, end) => insertComposerText(value, start, end, snippet));
  }

  function insertLink() {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const selected = value.slice(start, end).trim();
    const url = window.prompt(
      'Link URL',
      selected.startsWith('http') ? selected : 'https://',
    );
    if (!url?.trim()) return;
    const href = url.trim();
    if (selected && !selected.startsWith('http')) {
      run((s, e) => ({
        value: `${value.slice(0, s)}${selected} (${href})${value.slice(e)}`,
        selectionStart: s,
        selectionEnd: s + selected.length + href.length + 3,
      }));
      return;
    }
    run((s, e) => insertComposerText(value, s, e, href));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      onModEnter?.();
      return;
    }
    if (!mod) return;
    if (event.key === 'b') {
      event.preventDefault();
      wrap('*');
    } else if (event.key === 'i') {
      event.preventDefault();
      wrap('_');
    } else if (event.key === 'e') {
      event.preventDefault();
      wrap('`', 'code');
    } else if (event.key === 'u') {
      event.preventDefault();
      insertLink();
    }
  }

  return (
    <div className={`mrkdwn-editor${className ? ` ${className}` : ''}`}>
      {label ? <span className="mrkdwn-editor-label">{label}</span> : null}
      <div className="mrkdwn-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" title="Bold (Ctrl/⌘B)" onClick={() => wrap('*')}>
          <strong>B</strong>
        </button>
        <button type="button" title="Italic (Ctrl/⌘I)" onClick={() => wrap('_')}>
          <em>I</em>
        </button>
        <button
          type="button"
          title="Strikethrough"
          onClick={() => wrap('~', 'text')}
        >
          <s>S</s>
        </button>
        <button
          type="button"
          title="Inline code (Ctrl/⌘E)"
          onClick={() => wrap('`', 'code')}
        >
          {'</>'}
        </button>
        <span className="mrkdwn-toolbar-sep" aria-hidden="true" />
        <button type="button" title="Bullet list" onClick={() => prefix('- ')}>
          • List
        </button>
        <button
          type="button"
          title="Numbered list"
          onClick={() => prefix('1. ')}
        >
          1. List
        </button>
        <button type="button" title="Insert link (Ctrl/⌘U)" onClick={insertLink}>
          Link
        </button>
        <button
          type="button"
          title="Quote"
          onClick={() => prefix('> ')}
        >
          “”
        </button>
      </div>
      <textarea
        {...textareaProps}
        ref={ref}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="mrkdwn-editor-input"
      />
      {hint ? <span className="mrkdwn-editor-hint muted">{hint}</span> : null}
    </div>
  );
}
