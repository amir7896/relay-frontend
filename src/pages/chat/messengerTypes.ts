import type { Conversation, MessageReminder } from '../../api/types';

export type MessengerOutletContext = {
  openNewChat: () => void;
  openNewGroup: () => void;
  openWiki: () => void;
  clearUnread: (conversationId: string) => void;
  setUnread: (
    conversationId: string,
    unreadCount: number,
    opts?: { firstUnreadMessageId?: string | null },
  ) => void;
  refreshInbox: () => Promise<void>;
  conversations: Conversation[];
  laterItems: MessageReminder[];
  refreshLater: () => Promise<void>;
};
