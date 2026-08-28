import { useOutletContext } from 'react-router-dom';
import type { MessengerOutletContext } from './MessengerPage';

export function EmptyThread() {
  const { openNewChat, openNewGroup } = useOutletContext<MessengerOutletContext>();

  return (
    <div className="thread empty-thread">
      <div className="empty-panel">
        <span className="empty-glyph" aria-hidden="true" />
        <h2>Your messages live here</h2>
        <p className="muted">
          Pick a conversation from the sidebar, or start a new chat or group.
        </p>
        <div className="empty-actions">
          <button className="btn" type="button" onClick={openNewChat}>
            New chat
          </button>
          <button className="ghost" type="button" onClick={openNewGroup}>
            New group
          </button>
        </div>
      </div>
    </div>
  );
}
