import { useOutletContext } from 'react-router-dom';
import type { MessengerOutletContext } from './messengerTypes';

export function EmptyThread() {
  const { openNewChat, openNewGroup } = useOutletContext<MessengerOutletContext>();

  return (
    <div className="thread empty-thread">
      <div className="empty-panel">
        <span className="empty-glyph" aria-hidden="true" />
        <h2>Welcome to your workspace</h2>
        <p className="muted">
          Pick a channel on the left, message a teammate, or create a new
          channel for a topic.
        </p>
        <div className="empty-actions">
          <button className="btn" type="button" onClick={openNewGroup}>
            Create a channel
          </button>
          <button className="ghost" type="button" onClick={openNewChat}>
            Direct message
          </button>
        </div>
      </div>
    </div>
  );
}
