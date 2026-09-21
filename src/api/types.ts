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
  totpEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
};

export type OrgMemberRole = 'owner' | 'admin' | 'member' | 'guest';

export type OrganizationView = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  isDefault: boolean;
  role?: OrgMemberRole;
  plan?: 'free' | 'pro' | 'enterprise';
  maxSeats?: number;
  seatCount?: number;
  ssoEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OrgSsoView = {
  organizationId: string;
  ssoEnabled: boolean;
  ssoProvider: 'oidc' | 'saml' | null;
  ssoIssuerUrl: string | null;
  ssoClientId: string | null;
  hasClientSecret: boolean;
  ssoIdpSsoUrl: string | null;
  hasIdpCertificate: boolean;
  plan: 'free' | 'pro' | 'enterprise';
  configured: boolean;
};

export type ChannelInvite = {
  id: string;
  conversationId: string;
  conversationName?: string | null;
  token: string | null;
  inviteUrl: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  emailSent?: boolean;
  debugInviteUrl?: string;
};

export type ChannelInvitePreview = {
  valid: boolean;
  conversationId: string | null;
  conversationName: string | null;
  organizationId: string | null;
  expiresAt: string | null;
  message?: string;
};

export type IncomingWebhook = {
  id: string;
  conversationId: string;
  name: string;
  defaultUsername: string;
  defaultIconUrl: string | null;
  token?: string | null;
  webhookUrl?: string | null;
  createdBy: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type OutgoingWebhook = {
  id: string;
  conversationId: string;
  name: string;
  targetUrl: string;
  excludeBots: boolean;
  signingSecret?: string | null;
  createdBy: string;
  revokedAt: string | null;
  lastDeliveredAt: string | null;
  failureCount: number;
  createdAt: string;
};

export type SlashCommand = {
  id: string;
  name: string;
  description: string;
  responseTemplate: string;
  responseMode: 'in_channel' | 'ephemeral';
  requestUrl: string | null;
  builtin: boolean;
  createdBy: string | null;
  revokedAt: string | null;
  createdAt: string | null;
};

export type UserGroup = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthResult = {
  user: AuthUser;
  tokens: TokenPair;
  organizations: OrganizationView[];
  activeOrganizationId: string | null;
  pendingChannelId?: string | null;
};

export type AuthRequires2fa = {
  requires2fa: true;
  tempToken: string;
  userId: string;
  email: string;
};

export type SessionView = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
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

export type PresenceStatus = 'online' | 'away' | 'busy' | 'dnd' | 'offline';

export type ConversationMember = {
  userId: string;
  role: string;
  joinedAt: string;
  lastReadAt: string | null;
  muted?: boolean;
  status: PresenceStatus;
  lastSeenAt: string | null;
  customStatus?: string | null;
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

export type ThreadSummary = {
  conversationId: string;
  conversationName: string | null;
  conversationType: 'private' | 'group';
  root: ChatMessage;
  latestReply: ChatMessage | null;
  replyCount: number;
  lastReplyAt: string;
  followed?: boolean;
  unreadCount?: number;
  hasUnread?: boolean;
};

export type MentionActivity = {
  conversationId: string;
  conversationName: string | null;
  conversationType: 'private' | 'group';
  message: ChatMessage;
  unread: boolean;
};

export type UserNotification = {
  id: string;
  organizationId: string;
  userId: string;
  actorId: string;
  type: string;
  title: string;
  body: string;
  conversationId: string | null;
  listId: string | null;
  listItemId: string | null;
  meta: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  unread: boolean;
};

export type DraftInboxItem = {
  conversationId: string;
  conversationName: string | null;
  conversationType: 'private' | 'group';
  body: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: string;
  replyTo: MessageReply | null;
  threadRootId?: string | null;
  replyCount?: number;
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
  botUsername?: string | null;
  botIconUrl?: string | null;
  createdAt: string;
  /** Client-only: optimistic send state for attachments */
  sendStatus?: 'uploading' | 'sending' | 'failed';
  /** Client-only: 0–100 while uploading */
  uploadProgress?: number;
  /** Client-only: translation overlay */
  translatedText?: string | null;
  /** Client-only: show original instead of translation */
  showOriginal?: boolean;
};

export type MessageEditVersion = {
  id: string;
  body: string;
  editorId: string;
  createdAt: string;
};

export type MessageEditHistory = {
  messageId: string;
  currentBody: string;
  currentEditedAt: string | null;
  versions: MessageEditVersion[];
};

export type SidebarSection = {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  conversationIds: string[];
  createdAt: string;
  updatedAt: string;
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

export type MessageReminder = {
  id: string;
  conversationId: string;
  messageId: string;
  remindAt: string;
  status: 'pending' | 'sent' | 'cancelled' | 'completed';
  notifiedAt: string | null;
  completedAt?: string | null;
  createdAt: string;
  bodySnippet?: string;
  conversationName?: string | null;
  conversationType?: 'private' | 'group';
};

export type ChannelBookmark = {
  id: string;
  title: string;
  url: string;
  createdBy: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  type: 'private' | 'group';
  name: string | null;
  createdBy: string;
  visibility?: 'public' | 'private';
  announceOnly?: boolean;
  topic?: string | null;
  description?: string | null;
  bookmarks?: ChannelBookmark[];
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
  isShared?: boolean;
  sharedExternalLabel?: string | null;
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
  status: PresenceStatus;
  lastSeenAt: string | null;
  customStatus?: string | null;
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

export type WorkspaceCustomEmoji = {
  shortcode: string;
  emoji?: string;
  imageUrl?: string | null;
};

export type WorkspaceSettings = {
  appName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string | null;
  customEmojis: WorkspaceCustomEmoji[];
};

export type SeenResult = {
  conversationId: string;
  userId: string;
  lastReadAt: string;
  messageId: string | null;
};

export type ConversationCanvas = {
  id: string;
  organizationId: string;
  conversationId: string;
  title: string;
  body: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string | null;
};

export type ChannelListItemStatus = 'todo' | 'doing' | 'done';

export type ChannelListItem = {
  id: string;
  listId: string;
  title: string;
  status: ChannelListItemStatus;
  assigneeId: string | null;
  sortOrder: number;
  createdAt: string;
};

export type ChannelList = {
  id: string;
  organizationId: string;
  conversationId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  items?: ChannelListItem[];
};

export type Clip = {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId: string | null;
  createdBy: string;
  mediaUrl: string;
  mediaType: 'audio' | 'video';
  durationSeconds: number | null;
  createdAt: string;
};

export type WorkflowTriggerType = 'message_contains' | 'channel_created' | 'manual';
export type WorkflowActionType = 'post_message' | 'webhook' | 'set_reminder';

export type Workflow = {
  id: string;
  organizationId: string;
  conversationId: string | null;
  name: string;
  enabled: boolean;
  triggerType: WorkflowTriggerType;
  triggerConfig: Record<string, unknown>;
  actionType: WorkflowActionType;
  actionConfig: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
};

export type AppCatalogItem = {
  key: string;
  name: string;
  description: string;
  icon: string;
  iconUrl?: string | null;
  installed?: boolean;
  configurable?: boolean;
  category?: 'integration' | 'bot';
  oauthRequired?: boolean;
  capabilities?: Array<'unfurl' | 'create_issue' | 'events' | 'meetings'>;
  connected?: boolean;
  connectionStatus?: string | null;
  providerAccountName?: string | null;
};

export type InstalledApp = {
  id: string;
  organizationId: string;
  appKey: string;
  key: string;
  name?: string;
  description?: string;
  config: Record<string, unknown>;
  installedBy: string;
  createdAt: string;
  configurable?: boolean;
  category?: 'integration' | 'bot';
  oauthRequired?: boolean;
  capabilities?: Array<'unfurl' | 'create_issue' | 'events' | 'meetings'>;
  connected?: boolean;
  connectionStatus?: string | null;
  providerAccountName?: string | null;
};

export type ConnectInvite = {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  acceptedAt?: string | null;
  token?: string;
  inviteUrl?: string | null;
  inviteKind?: 'guest_email' | 'workspace_share';
  partnerOrganizationName?: string | null;
};

export type ConnectLink = {
  id: string;
  hostOrganizationId: string;
  hostConversationId: string;
  partnerOrganizationId: string;
  partnerConversationId: string;
  partnerOrganizationName: string | null;
  hostOrganizationName: string | null;
  status: 'pending' | 'active' | 'disconnected';
  createdBy: string;
  acceptedBy: string | null;
  createdAt: string;
  disconnectedAt: string | null;
};

export type ConnectStatus = {
  conversationId: string;
  isShared: boolean;
  sharedExternalLabel: string | null;
  conversationName?: string | null;
  invites: ConnectInvite[];
  links?: ConnectLink[];
  connectRole?: 'host' | 'partner' | null;
  hostConversationId?: string | null;
};
