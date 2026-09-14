export type ApiEnvelope<T> = {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
  timestamp?: string;
  path?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
};

export type OrgMemberRole = 'owner' | 'admin' | 'member';

export type OrganizationView = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  isDefault: boolean;
  role?: OrgMemberRole;
  createdAt: string;
  updatedAt: string;
};

export type AuthResult = {
  user: AuthUser;
  tokens: TokenPair;
  organizations: OrganizationView[];
  activeOrganizationId: string | null;
};

export type UserProfile = {
  id: string;
  userId: string;
  organizationId?: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  bio: string | null;
  avatar: string | null;
  dateOfBirth: string | null;
  showLastSeen: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMember = {
  userId: string;
  role: string;
  joinedAt: string;
  lastReadAt: string | null;
  muted?: boolean;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
};

export type MessageReply = {
  id: string;
  senderId: string;
  body: string;
  type?: string;
  deletedForEveryone: boolean;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export type MessageAttachment = {
  url: string;
  mime: string;
  name: string;
  size: number;
};

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  image: string | null;
};

export type PollOption = {
  id: string;
  text: string;
  voteCount: number;
  votedByMe: boolean;
};

export type PollView = {
  question: string;
  options: PollOption[];
  allowMultiple: boolean;
  closed: boolean;
  totalVotes: number;
};

export type MessageBookmark = {
  id: string;
  conversationId: string;
  messageId: string;
  createdAt: string;
  message: ChatMessage;
  conversationName: string | null;
  conversationType: 'private' | 'group';
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: string;
  replyTo: MessageReply | null;
  attachment: MessageAttachment | null;
  mentions: string[];
  linkPreview: LinkPreview | null;
  poll?: PollView | null;
  reactions: MessageReaction[];
  editedAt: string | null;
  pinned?: boolean;
  pinnedAt?: string | null;
  pinnedByUserId?: string | null;
  forwarded: boolean;
  deletedForEveryone: boolean;
  seenBy: string[];
  undelivered?: boolean;
  expiresAt?: string | null;
  createdAt: string;
  /** Client-only: optimistic send state for attachments */
  sendStatus?: 'uploading' | 'sending' | 'failed';
  /** Client-only: 0–100 while uploading */
  uploadProgress?: number;
};

export type GlobalSearchHit = {
  message: ChatMessage;
  conversation: {
    id: string;
    type: 'private' | 'group';
    name: string | null;
    members: Array<{ userId: string }>;
  };
};

export type ScheduledMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: string;
  replyToMessageId: string | null;
  attachment: MessageAttachment | null;
  mentions: string[];
  linkPreview: LinkPreview | null;
  scheduledFor: string;
  status: 'pending' | 'sending' | 'sent' | 'cancelled' | 'failed';
  sentMessageId: string | null;
  error: string | null;
  createdAt: string;
};

export type Conversation = {
  id: string;
  type: 'private' | 'group';
  name: string | null;
  createdBy: string;
  lastMessageAt: string | null;
  lastMessage: ChatMessage | null;
  lastReadAt: string | null;
  muted: boolean;
  pinned: boolean;
  disappearingDurationSeconds?: number;
  blockedByMe?: boolean;
  blockedMe?: boolean;
  unreadCount: number;
  hasUnreadMention?: boolean;
  firstUnreadMentionMessageId?: string | null;
  members: ConversationMember[];
  createdAt: string;
  updatedAt: string;
};

export type BlockView = {
  userId: string;
  createdAt: string;
};

export type Paginated<T> = {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export type Presence = {
  userId: string;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
};

export type ChatAnalytics = {
  onlineUsers: number;
  totalConversations: number;
  totalMessages: number;
  messagesToday: number;
  messagesThisWeek: number;
  activeConversationsToday: number;
  messagesByDay: { date: string; count: number }[];
  topConversations: {
    conversationId: string;
    name: string | null;
    type: string;
    messageCount: number;
  }[];
};

export type AuditEvent = {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceSettings = {
  appName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string | null;
};

export type SeenResult = {
  conversationId: string;
  userId: string;
  lastReadAt: string;
  messageId: string | null;
};
