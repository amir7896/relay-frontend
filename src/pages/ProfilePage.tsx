import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useOrganization } from '../organizations/OrganizationContext';
import { useConfirm, usePrompt } from '../components/ConfirmProvider';
import { PasswordInput } from '../components/PasswordInput';
import { PeoplePicker } from '../components/PeoplePicker';
import { resolveMediaUrl } from '../components/VoiceNotePlayer';
import { displayName, initials } from '../lib/format';
import {
  getNotificationPermission,
  subscribeWebPush,
  loadNotificationPrefs,
  saveNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from '../lib/notifications';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { resetDemoTour } from '../components/DemoTour';
import { useDirectory } from '../people/useDirectory';
import type {
  SessionView,
  SlashCommand,
  UserGroup,
  UserProfile,
  WorkspaceSettings,
} from '../api/types';
import { getSession } from '../auth/session';
import { useWorkspace } from '../theme/WorkspaceContext';

type WorkspaceInvite = {
  id: string;
  email: string | null;
  organizationId?: string | null;
  organizationName?: string;
  inviteUrl: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  debugInviteUrl?: string;
  emailSent?: boolean;
};

export function ProfilePage() {
  const { session, logout, replaceSession } = useAuth();
  const {
    organizations,
    activeOrganizationId,
    deleteOrganization,
    leaveOrganization,
    refreshOrganizations,
  } = useOrganization();
  const confirmDialog = useConfirm();
  const promptDialog = usePrompt();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState(() => getNotificationPermission());
  const [notifyHint, setNotifyHint] = useState('');
  const [notifyPrefs, setNotifyPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [notifyPrefsBusy, setNotifyPrefsBusy] = useState(false);
  const [installHint, setInstallHint] = useState('');
  const { canInstall, standalone, install } = usePwaInstall();
  const isAdmin = session?.user.role === 'admin';
  const activeOrg =
    organizations.find((org) => org.id === activeOrganizationId) ??
    organizations[0];
  const canManageInvites =
    activeOrg?.role === 'owner' ||
    activeOrg?.role === 'admin' ||
    isAdmin;
  const canManageWorkspace =
    activeOrg?.role === 'owner' || activeOrg?.role === 'admin';
  const isWorkspaceOwner = activeOrg?.role === 'owner';
  const canDeleteWorkspace =
    Boolean(activeOrg) &&
    activeOrg?.role === 'owner' &&
    !activeOrg?.isDefault;
  const canLeaveWorkspace = Boolean(activeOrg) && !activeOrg?.isDefault;
  const [branding, setBranding] = useState<WorkspaceSettings | null>(null);
  const [brandingSaved, setBrandingSaved] = useState('');
  const [customEmojiDraft, setCustomEmojiDraft] = useState({
    shortcode: '',
    emoji: '',
    imageFile: null as File | null,
  });
  const [customEmojiSaved, setCustomEmojiSaved] = useState('');
  const [customEmojiBusy, setCustomEmojiBusy] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [slashDraft, setSlashDraft] = useState({
    name: '',
    description: '',
    responseTemplate: '',
  });
  const [slashSaved, setSlashSaved] = useState('');
  const [slashBusy, setSlashBusy] = useState(false);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [userGroupDraft, setUserGroupDraft] = useState({
    handle: '',
    name: '',
    description: '',
    memberIds: [] as string[],
  });
  const [editingUserGroupId, setEditingUserGroupId] = useState<string | null>(
    null,
  );
  const [userGroupSaved, setUserGroupSaved] = useState('');
  const [userGroupBusy, setUserGroupBusy] = useState(false);
  const { people } = useDirectory();
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceNameSaved, setWorkspaceNameSaved] = useState('');
  const [members, setMembers] = useState<
    Array<{ userId: string; role: string; joinedAt: string; label?: string }>
  >([]);
  const [membersBusy, setMembersBusy] = useState(false);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteHint, setInviteHint] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [planDraft, setPlanDraft] = useState<'free' | 'pro' | 'enterprise'>(
    'free',
  );
  const [presenceDraft, setPresenceDraft] = useState<
    'online' | 'away' | 'busy' | 'dnd'
  >('online');
  const [customStatusDraft, setCustomStatusDraft] = useState('');
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [ssoDraft, setSsoDraft] = useState({
    ssoEnabled: false,
    ssoProvider: 'oidc' as 'oidc' | 'saml',
    ssoIssuerUrl: '',
    ssoClientId: '',
    ssoClientSecret: '',
  });
  const [inviteRole, setInviteRole] = useState<'member' | 'guest'>('member');
  const inviteEmailTrimmed = inviteEmail.trim();
  const inviteEmailValid =
    inviteEmailTrimmed.length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmailTrimmed);
  const inviteEmailInvalid =
    inviteEmailTrimmed.length > 0 && !inviteEmailValid;
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void api<UserProfile>('/users/me')
      .then((response) => {
        setProfile(response.data);
        setAvatarDraft(response.data.avatar ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not load profile');
      });
  }, []);

  useEffect(() => {
    void api<{ totpEnabled?: boolean }>('/auth/me')
      .then((response) => {
        setTotpEnabled(Boolean(response.data.totpEnabled));
      })
      .catch(() => {
        // ignore
      });
    const refreshToken = getSession()?.refreshToken;
    void api<SessionView[]>(
      `/auth/sessions${
        refreshToken ? `?refreshToken=${encodeURIComponent(refreshToken)}` : ''
      }`,
    )
      .then((response) => setSessions(response.data))
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    setPlanDraft(activeOrg?.plan ?? 'free');
    if (!activeOrganizationId) return;
    void api<{
      ssoEnabled: boolean;
      ssoProvider: 'oidc' | 'saml' | null;
      ssoIssuerUrl: string | null;
      ssoClientId: string | null;
      hasClientSecret?: boolean;
    }>(`/organizations/${activeOrganizationId}/sso`)
      .then((response) => {
        setSsoDraft({
          ssoEnabled: response.data.ssoEnabled,
          ssoProvider: response.data.ssoProvider ?? 'oidc',
          ssoIssuerUrl: response.data.ssoIssuerUrl ?? '',
          ssoClientId: response.data.ssoClientId ?? '',
          ssoClientSecret: '',
        });
      })
      .catch(() => {
        // ignore
      });
  }, [activeOrganizationId, activeOrg?.plan]);

  useEffect(() => {
    setNotifyStatus(getNotificationPermission());
    void loadNotificationPrefs().then(setNotifyPrefs);
  }, []);

  useEffect(() => {
    setWorkspaceName(activeOrg?.name ?? '');
  }, [activeOrg?.id, activeOrg?.name]);

  useEffect(() => {
    if (!canManageWorkspace) {
      setBranding(null);
      return;
    }
    void api<WorkspaceSettings>('/workspace/settings')
      .then((response) =>
        setBranding({
          ...response.data,
          customEmojis: Array.isArray(response.data.customEmojis)
            ? response.data.customEmojis
            : [],
        }),
      )
      .catch(() => undefined);
  }, [canManageWorkspace, activeOrganizationId]);

  useEffect(() => {
    if (!canManageInvites) {
      return;
    }
    void loadInvites();
  }, [canManageInvites, activeOrganizationId]);

  useEffect(() => {
    if (!canManageWorkspace || !activeOrg?.id) {
      setMembers([]);
      return;
    }
    void loadMembers(activeOrg.id);
  }, [canManageWorkspace, activeOrg?.id]);

  useEffect(() => {
    if (!canManageWorkspace) {
      setSlashCommands([]);
      setUserGroups([]);
      return;
    }
    void loadSlashCommands();
    void loadUserGroups();
  }, [canManageWorkspace, activeOrganizationId]);

  async function loadInvites() {
    try {
      const response = await api<WorkspaceInvite[]>('/auth/invites');
      setInvites(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invites');
    }
  }

  async function loadMembers(organizationId: string) {
    setMembersBusy(true);
    try {
      const response = await api<
        Array<{ userId: string; role: string; joinedAt: string }>
      >(`/organizations/${organizationId}/members`);
      const rows = response.data ?? [];
      const labeled = await Promise.all(
        rows.map(async (row) => {
          try {
            const profile = await api<UserProfile>(`/users/lookup/${row.userId}`);
            return {
              ...row,
              label: `${profile.data.firstName} ${profile.data.lastName}`.trim(),
            };
          } catch {
            return { ...row, label: row.userId.slice(0, 8) };
          }
        }),
      );
      setMembers(labeled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load members');
    } finally {
      setMembersBusy(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteEmailValid) {
      return;
    }
    setInviteBusy(true);
    setError('');
    setInviteHint('');
    const form = new FormData(event.currentTarget);
    const email = inviteEmailTrimmed;
    try {
      const response = await api<WorkspaceInvite>('/auth/invites', {
        method: 'POST',
        body: JSON.stringify({
          email,
          expiresInDays: Number(form.get('expiresInDays') ?? 7),
          maxUses: 1,
          role: inviteRole,
        }),
      });
      const link = response.data.debugInviteUrl || response.data.inviteUrl;
      setInviteUrl(link);
      if (response.data.emailSent) {
        setInviteHint(`Invite emailed to ${email}. You can still copy the link below.`);
      } else {
        setInviteHint(
          'SMTP is not configured (or send failed). Copy the link and share it — works with Gmail, YOPmail, etc.',
        );
      }
      event.currentTarget.reset();
      setInviteEmail('');
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    try {
      await api(`/auth/invites/${id}`, { method: 'DELETE' });
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke invite');
    }
  }

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branding) {
      return;
    }
    setBrandingSaved('');
    try {
      const response = await api<WorkspaceSettings>('/workspace/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          appName: branding.appName,
          tagline: branding.tagline,
          primaryColor: branding.primaryColor,
          logoUrl: branding.logoUrl,
        }),
      });
      setBranding({
        ...response.data,
        customEmojis: Array.isArray(response.data.customEmojis)
          ? response.data.customEmojis
          : branding.customEmojis ?? [],
      });
      document.documentElement.style.setProperty('--brand', response.data.primaryColor);
      await workspace.refresh();
      setBrandingSaved('Workspace branding saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save branding');
    }
  }

  async function saveCustomEmojis(
    next: WorkspaceSettings['customEmojis'],
  ): Promise<boolean> {
    if (!branding) {
      return false;
    }
    setCustomEmojiBusy(true);
    setCustomEmojiSaved('');
    setError('');
    try {
      const response = await api<WorkspaceSettings>('/workspace/settings', {
        method: 'PATCH',
        body: JSON.stringify({ customEmojis: next }),
      });
      setBranding({
        ...response.data,
        customEmojis: Array.isArray(response.data.customEmojis)
          ? response.data.customEmojis
          : next,
      });
      await workspace.refresh();
      setCustomEmojiSaved('Custom emoji updated');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save custom emoji');
      return false;
    } finally {
      setCustomEmojiBusy(false);
    }
  }

  async function addCustomEmoji(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branding) {
      return;
    }
    const shortcode = customEmojiDraft.shortcode
      .trim()
      .toLowerCase()
      .replace(/^:+|:+$/g, '');
    const emoji = customEmojiDraft.emoji.trim();
    if (!shortcode) {
      setError('Shortcode is required');
      return;
    }
    if ((branding.customEmojis ?? []).some((row) => row.shortcode === shortcode)) {
      setError(`:${shortcode}: already exists`);
      return;
    }
    setCustomEmojiBusy(true);
    setError('');
    try {
      let imageUrl: string | null = null;
      if (customEmojiDraft.imageFile) {
        const form = new FormData();
        form.append('file', customEmojiDraft.imageFile);
        const uploaded = await api<{ url: string }>('/workspace/emojis/upload', {
          method: 'POST',
          body: form,
        });
        imageUrl = uploaded.data.url;
      }
      if (!emoji && !imageUrl) {
        setError('Provide a Unicode emoji or upload an image');
        return;
      }
      const ok = await saveCustomEmojis([
        ...(branding.customEmojis ?? []),
        {
          shortcode,
          ...(emoji ? { emoji } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        },
      ]);
      if (ok) {
        setCustomEmojiDraft({ shortcode: '', emoji: '', imageFile: null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add custom emoji');
    } finally {
      setCustomEmojiBusy(false);
    }
  }

  async function loadSlashCommands() {
    try {
      const response = await api<SlashCommand[]>('/chat/slash-commands');
      setSlashCommands(response.data);
    } catch {
      setSlashCommands([]);
    }
  }

  async function createSlashCommand(event: FormEvent) {
    event.preventDefault();
    const name = slashDraft.name.trim().replace(/^\//, '');
    const description = slashDraft.description.trim();
    const responseTemplate = slashDraft.responseTemplate.trim();
    if (!name || !description || !responseTemplate) {
      return;
    }
    setSlashBusy(true);
    setError('');
    setSlashSaved('');
    try {
      await api<SlashCommand>('/chat/slash-commands', {
        method: 'POST',
        body: JSON.stringify({ name, description, responseTemplate }),
      });
      setSlashDraft({ name: '', description: '', responseTemplate: '' });
      setSlashSaved(`/${name} created — try it in any channel`);
      await loadSlashCommands();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create slash command',
      );
    } finally {
      setSlashBusy(false);
    }
  }

  async function revokeSlashCommand(command: SlashCommand) {
    if (command.builtin) return;
    const ok = await confirmDialog({
      title: 'Revoke slash command?',
      message: `/${command.name} will stop working for everyone.`,
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      await api(`/chat/slash-commands/${command.id}`, { method: 'DELETE' });
      await loadSlashCommands();
      setSlashSaved(`/${command.name} revoked`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not revoke slash command',
      );
    }
  }

  async function loadUserGroups() {
    try {
      const response = await api<UserGroup[]>('/chat/user-groups');
      setUserGroups(response.data);
    } catch {
      setUserGroups([]);
    }
  }

  function resetUserGroupDraft() {
    setUserGroupDraft({
      handle: '',
      name: '',
      description: '',
      memberIds: [],
    });
    setEditingUserGroupId(null);
  }

  function startEditUserGroup(group: UserGroup) {
    setEditingUserGroupId(group.id);
    setUserGroupDraft({
      handle: group.handle,
      name: group.name,
      description: group.description ?? '',
      memberIds: [...group.memberIds],
    });
    setUserGroupSaved('');
  }

  function toggleUserGroupMember(userId: string) {
    setUserGroupDraft((draft) => {
      const has = draft.memberIds.includes(userId);
      return {
        ...draft,
        memberIds: has
          ? draft.memberIds.filter((id) => id !== userId)
          : [...draft.memberIds, userId],
      };
    });
  }

  async function saveUserGroup(event: FormEvent) {
    event.preventDefault();
    const handle = userGroupDraft.handle.trim().replace(/^@/, '');
    const name = userGroupDraft.name.trim();
    const description = userGroupDraft.description.trim();
    if (!handle || !name || userGroupDraft.memberIds.length === 0) {
      return;
    }
    setUserGroupBusy(true);
    setError('');
    setUserGroupSaved('');
    try {
      if (editingUserGroupId) {
        await api<UserGroup>(`/chat/user-groups/${editingUserGroupId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            handle,
            name,
            description: description || null,
            memberIds: userGroupDraft.memberIds,
          }),
        });
        setUserGroupSaved(`@${handle} updated`);
      } else {
        await api<UserGroup>('/chat/user-groups', {
          method: 'POST',
          body: JSON.stringify({
            handle,
            name,
            description: description || undefined,
            memberIds: userGroupDraft.memberIds,
          }),
        });
        setUserGroupSaved(`@${handle} created — mention it in any channel`);
      }
      resetUserGroupDraft();
      await loadUserGroups();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save user group',
      );
    } finally {
      setUserGroupBusy(false);
    }
  }

  async function deleteUserGroup(group: UserGroup) {
    const ok = await confirmDialog({
      title: 'Delete user group?',
      message: `@${group.handle} will stop notifying members when mentioned.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      await api(`/chat/user-groups/${group.id}`, { method: 'DELETE' });
      if (editingUserGroupId === group.id) {
        resetUserGroupDraft();
      }
      await loadUserGroups();
      setUserGroupSaved(`@${group.handle} deleted`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not delete user group',
      );
    }
  }

  async function saveWorkspaceName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrg?.id || !workspaceName.trim()) {
      return;
    }
    setWorkspaceNameSaved('');
    setError('');
    try {
      const response = await api<{ id: string; name: string; role: string }>(
        `/organizations/${activeOrg.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: workspaceName.trim() }),
        },
      );
      const current = session;
      if (current) {
        replaceSession({
          ...current,
          organizations: current.organizations.map((org) =>
            org.id === response.data.id
              ? { ...org, name: response.data.name }
              : org,
          ),
        });
      }
      setWorkspaceName(response.data.name);
      setWorkspaceNameSaved('Workspace renamed');
      await refreshOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename workspace');
    }
  }

  async function changeMemberRole(
    userId: string,
    role: 'admin' | 'member' | 'guest',
  ) {
    if (!activeOrg?.id) {
      return;
    }
    setError('');
    try {
      await api(`/organizations/${activeOrg.id}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await loadMembers(activeOrg.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role');
    }
  }

  async function kickMember(userId: string, label: string) {
    if (!activeOrg?.id) {
      return;
    }
    const ok = await confirmDialog({
      title: 'Remove member?',
      message: `Remove ${label} from ${activeOrg.name}? They will lose access to this workspace.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setError('');
    try {
      await api(`/organizations/${activeOrg.id}/members/${userId}`, {
        method: 'DELETE',
      });
      await loadMembers(activeOrg.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove member');
    }
  }

  async function transferOwnershipTo(userId: string, label: string) {
    if (!activeOrg?.id) {
      return;
    }
    const ok = await confirmDialog({
      title: 'Transfer ownership?',
      message: `Make ${label} the owner of ${activeOrg.name}? You will become an admin.`,
      confirmLabel: 'Transfer',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setError('');
    try {
      await api(`/organizations/${activeOrg.id}/transfer-ownership`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      await refreshOrganizations();
      await loadMembers(activeOrg.id);
      setSaved('Ownership transferred');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transfer ownership');
    }
  }

  async function enableDesktopNotifications() {
    setNotifyHint('');
    try {
      const permission = await subscribeWebPush();
      setNotifyStatus(permission === 'disabled' ? 'granted' : permission);
      if (permission === 'granted') {
        setNotifyHint('Desktop and push notifications are on.');
      } else if (permission === 'disabled') {
        setNotifyHint('Desktop notifications are on, but server push is not configured.');
      } else if (permission === 'denied') {
        setNotifyHint(
          'Notifications are blocked in your browser. Open site settings for this page and allow notifications.',
        );
      } else if (permission === 'unsupported') {
        setNotifyHint('This browser does not support push notifications.');
      }
    } catch (err) {
      setNotifyHint(err instanceof Error ? err.message : 'Could not enable push notifications.');
      setNotifyStatus(getNotificationPermission());
    }
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG, PNG, GIF, or WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be 10MB or smaller.');
      return;
    }

    setError('');
    setSaved('');
    setAvatarUploading(true);
    const previewUrl = URL.createObjectURL(file);
    setAvatarDraft(previewUrl);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await api<
        UserProfile & {
          upload?: { url?: string; key?: string; provider?: string };
        }
      >('/users/me/avatar', {
        method: 'POST',
        body,
      });
      const nextAvatar =
        response.data.avatar?.trim() ||
        response.data.upload?.url?.trim() ||
        null;
      if (!nextAvatar) {
        throw new Error('Upload succeeded but no photo URL was returned');
      }
      // Confirm the URL was persisted (survives refresh).
      const confirmed = await api<UserProfile>('/users/me');
      const savedAvatar = confirmed.data.avatar?.trim() || nextAvatar;
      setProfile(confirmed.data);
      setAvatarDraft(savedAvatar);
      setSaved('Profile photo saved to Cloudinary');
    } catch (err) {
      setAvatarDraft(profile?.avatar ?? null);
      setError(err instanceof Error ? err.message : 'Could not upload photo');
    } finally {
      URL.revokeObjectURL(previewUrl);
      setAvatarUploading(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  }

  async function removeAvatar() {
    setError('');
    setSaved('');
    setAvatarUploading(true);
    try {
      const response = await api<UserProfile>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatar: '' }),
      });
      setProfile(response.data);
      setAvatarDraft(response.data.avatar ?? null);
      setSaved('Profile photo removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove photo');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaved('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | boolean | null> = {};
    for (const key of ['firstName', 'lastName', 'phone', 'bio', 'dateOfBirth']) {
      const value = String(form.get(key) ?? '').trim();
      if (value) {
        body[key] = value;
      }
    }
    // Photo is saved via POST /users/me/avatar — never clear it from this form.
    body.showLastSeen = form.get('showLastSeen') === 'on';
    try {
      const response = await api<UserProfile>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setProfile(response.data);
      setAvatarDraft(response.data.avatar ?? null);
      setSaved('Profile saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: form.get('currentPassword'),
          newPassword: form.get('newPassword'),
        }),
      });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password');
      setBusy(false);
    }
  }

  const name = profile
    ? `${profile.firstName} ${profile.lastName}`.trim()
    : session?.user.email ?? 'You';
  const avatarUrl = resolveMediaUrl((avatarDraft ?? profile?.avatar ?? '').trim());
  const notifyLabel =
    notifyStatus === 'granted'
      ? 'Allowed'
      : notifyStatus === 'denied'
        ? 'Blocked'
        : notifyStatus === 'unsupported'
          ? 'Unsupported'
          : 'Off';

  return (
    <main className="page profile-page">
      <section className="profile-hero-card">
        <div className="profile-avatar-wrap">
          {avatarUrl ? (
            <img className="profile-avatar-img" src={avatarUrl} alt="" />
          ) : (
            <div className="avatar xl profile-avatar-fallback">{initials(name)}</div>
          )}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void uploadAvatar(file);
              }
            }}
          />
          <button
            className="profile-avatar-edit"
            type="button"
            disabled={avatarUploading || busy}
            aria-label={avatarUploading ? 'Uploading photo' : 'Upload profile photo'}
            title={avatarUploading ? 'Uploading…' : 'Upload profile photo'}
            onClick={() => avatarInputRef.current?.click()}
          >
            {avatarUploading ? (
              <span className="profile-avatar-edit-busy">…</span>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 13h8v2H8v-2zm0 4h5v2H8v-2z"
                />
              </svg>
            )}
          </button>
          {avatarDraft && !avatarDraft.startsWith('blob:') ? (
            <button
              className="profile-avatar-remove"
              type="button"
              disabled={avatarUploading || busy}
              onClick={() => void removeAvatar()}
            >
              Remove photo
            </button>
          ) : null}
        </div>
        <div className="profile-hero-copy">
          <p className="eyebrow">Your account</p>
          <h1 className="profile-name">{name || 'Your profile'}</h1>
          <p className="profile-email">{session?.user.email}</p>
          <div className="profile-hero-meta">
            <span className="role-chip">{isAdmin ? 'Admin' : 'Member'}</span>
            {profile?.showLastSeen === false ? (
              <span className="profile-meta-chip">Last seen hidden</span>
            ) : null}
          </div>
          {profile?.bio ? <p className="profile-bio-preview">{profile.bio}</p> : null}
        </div>
      </section>

      {error ? <p className="error profile-flash">{error}</p> : null}
      {saved ? <p className="ok profile-flash">{saved}</p> : null}

      <form
        className="profile-sheet"
        key={profile?.id ?? 'profile'}
        onSubmit={(event) => void saveProfile(event)}
      >
        <header className="profile-sheet-head profile-sheet-head-row">
        <div>
            <h2>About</h2>
            <p className="muted">How you appear to people in Relay.</p>
          </div>
          <button className="btn profile-save-inline" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </header>

        <div className="profile-fields profile-fields-grid">
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <PersonIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">First name</span>
              <input name="firstName" defaultValue={profile?.firstName ?? ''} autoComplete="given-name" />
            </span>
          </label>
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <PersonIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Last name</span>
              <input name="lastName" defaultValue={profile?.lastName ?? ''} autoComplete="family-name" />
            </span>
          </label>
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <PhoneIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Phone</span>
              <input
                name="phone"
                defaultValue={profile?.phone ?? ''}
                autoComplete="tel"
                placeholder="Optional"
              />
            </span>
          </label>
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <CakeIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Birthday</span>
              <input
                name="dateOfBirth"
                placeholder="YYYY-MM-DD"
                defaultValue={profile?.dateOfBirth ?? ''}
              />
            </span>
          </label>
          <label className="profile-field profile-field-tall profile-field-span">
            <span className="profile-field-icon" aria-hidden="true">
              <InfoIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Bio</span>
              <textarea
                name="bio"
                rows={3}
                defaultValue={profile?.bio ?? ''}
                placeholder="A short line about you"
              />
            </span>
          </label>
          <label className="profile-field profile-check profile-field-span">
            <span className="profile-field-icon" aria-hidden="true">
              <EyeIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Show last seen</span>
              <span className="profile-check-row">
                <input
                  type="checkbox"
                  name="showLastSeen"
                  defaultChecked={profile?.showLastSeen !== false}
                />
                <span className="muted">Let others see when you were last online</span>
              </span>
            </span>
          </label>
        </div>

        <div className="profile-sheet-actions profile-sheet-actions-mobile">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
      </div>
      </form>

      <section className="profile-sheet">
        <header className="profile-sheet-head">
          <h2>Notifications</h2>
          <p className="muted">
            Control desktop alerts and offline push. Muted chats stay quiet unless you are
            @mentioned.
          </p>
        </header>
        <div className="profile-notify">
          <div className="profile-notify-row">
            <p className="profile-notify-status">
              Browser{' '}
              <span className={`notify-pill notify-pill-${notifyStatus}`}>{notifyLabel}</span>
            </p>
            {notifyStatus === 'default' ? (
              <button className="btn" type="button" onClick={() => void enableDesktopNotifications()}>
                Enable notifications
              </button>
            ) : null}
          </div>
          {notifyHint ? <p className="muted">{notifyHint}</p> : null}
          {notifyStatus === 'granted' ? (
            <p className="muted">
              To fully disable the browser permission, use site settings for this page.
            </p>
          ) : null}
          {notifyStatus === 'denied' ? (
            <p className="muted">
              Relay cannot ask again after a browser block. Allow notifications in the address-bar
              site settings, then refresh.
            </p>
          ) : null}

          <div className="profile-fields" style={{ marginTop: '1rem' }}>
          <label>
              Message alerts
              <select
                value={notifyPrefs.mode}
                onChange={(event) =>
                  setNotifyPrefs((current) => ({
                    ...current,
                    mode: event.target.value as NotificationPrefs['mode'],
                  }))
                }
              >
                <option value="all">All messages</option>
                <option value="mentions">Mentions only</option>
                <option value="none">Nothing</option>
              </select>
          </label>
          <label>
              <input
                type="checkbox"
                checked={notifyPrefs.quietHoursEnabled}
                onChange={(event) =>
                  setNotifyPrefs((current) => ({
                    ...current,
                    quietHoursEnabled: event.target.checked,
                  }))
                }
              />{' '}
              Quiet hours
          </label>
            {notifyPrefs.quietHoursEnabled ? (
              <div className="profile-notify-row" style={{ gap: '0.75rem' }}>
          <label>
                  From
                  <input
                    type="time"
                    value={notifyPrefs.quietStart}
                    onChange={(event) =>
                      setNotifyPrefs((current) => ({
                        ...current,
                        quietStart: event.target.value || '22:00',
                      }))
                    }
                  />
          </label>
          <label>
                  Until
                  <input
                    type="time"
                    value={notifyPrefs.quietEnd}
                    onChange={(event) =>
                      setNotifyPrefs((current) => ({
                        ...current,
                        quietEnd: event.target.value || '08:00',
                      }))
                    }
                  />
          </label>
        </div>
            ) : null}
        <label>
              Timezone
              <input
                value={notifyPrefs.timezone}
                onChange={(event) =>
                  setNotifyPrefs((current) => ({
                    ...current,
                    timezone: event.target.value,
                  }))
                }
                placeholder="Asia/Karachi"
              />
        </label>
        <label>
              <input
                type="checkbox"
                checked={notifyPrefs.respectStatus}
                onChange={(event) =>
                  setNotifyPrefs((current) => ({
                    ...current,
                    respectStatus: event.target.checked,
                  }))
                }
              />{' '}
              Silence alerts when Away / Busy / Do not disturb
        </label>
            <p className="muted">
              Mentions still break through quiet hours and Away. Do not disturb blocks calls too.
            </p>
            <button
              className="btn"
              type="button"
              disabled={notifyPrefsBusy}
              onClick={() => {
                setNotifyPrefsBusy(true);
                void saveNotificationPrefs({
                  ...notifyPrefs,
                  timezone:
                    notifyPrefs.timezone.trim() ||
                    Intl.DateTimeFormat().resolvedOptions().timeZone ||
                    'UTC',
                })
                  .then((savedPrefs) => {
                    setNotifyPrefs(savedPrefs);
                    setSaved('Notification preferences saved');
                  })
                  .catch((err: unknown) =>
                    setError(
                      err instanceof Error
                        ? err.message
                        : 'Could not save notification preferences',
                    ),
                  )
                  .finally(() => setNotifyPrefsBusy(false));
              }}
            >
              {notifyPrefsBusy ? 'Saving…' : 'Save notification preferences'}
            </button>
          </div>
        </div>
      </section>

      <section className="profile-sheet">
        <header className="profile-sheet-head">
          <h2>Install app</h2>
          <p className="muted">
            Add Relay to your home screen for a standalone window, faster launch, and offline shell.
          </p>
        </header>
        <div className="profile-notify">
          <div className="profile-notify-row">
            <p className="profile-notify-status">
              Status{' '}
              <span
                className={`notify-pill notify-pill-${
                  standalone ? 'granted' : canInstall ? 'default' : 'denied'
                }`}
              >
                {standalone ? 'Installed' : canInstall ? 'Available' : 'Not available'}
              </span>
            </p>
            {canInstall ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void install().then((outcome) => {
                    if (outcome === 'accepted') {
                      setInstallHint('Relay was added to this device.');
                    } else if (outcome === 'dismissed') {
                      setInstallHint('Install cancelled. You can try again anytime.');
                    } else {
                      setInstallHint(
                        'Install is not available in this browser session. Use the browser menu → Install app.',
                      );
                    }
                  });
                }}
              >
                Install Relay
              </button>
            ) : null}
          </div>
          {installHint ? <p className="muted">{installHint}</p> : null}
          {!canInstall && !standalone ? (
            <p className="muted">
              On supported browsers (Chrome / Edge on HTTPS or localhost), an install option appears
              after the app loads. On iPhone, use Share → Add to Home Screen.
            </p>
          ) : null}
          {standalone ? (
            <p className="muted">You are already running Relay as an installed app.</p>
          ) : null}
        </div>
      </section>

      {canManageWorkspace ? (
        <form className="profile-sheet" onSubmit={(event) => void saveWorkspaceName(event)}>
          <header className="profile-sheet-head profile-sheet-head-row">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>Rename {activeOrg?.name ?? 'workspace'}</h2>
              <p className="muted">Owners and workspace admins can change the display name.</p>
            </div>
            <button className="btn profile-save-inline" type="submit">
              Save name
            </button>
          </header>
          <div className="profile-fields">
            <label className="profile-plain-field">
              Workspace name
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
          </div>
          {workspaceNameSaved ? (
            <p className="ok profile-inline-ok">{workspaceNameSaved}</p>
          ) : null}
          <div className="profile-sheet-actions profile-sheet-actions-mobile">
        <button className="btn" type="submit">
              Save name
        </button>
          </div>
      </form>
      ) : null}

      {canManageWorkspace && branding ? (
        <form className="profile-sheet" onSubmit={(event) => void saveBranding(event)}>
          <header className="profile-sheet-head profile-sheet-head-row">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>Workspace branding</h2>
              <p className="muted">
                Name, tagline, and accent for this workspace (owners and admins).
              </p>
            </div>
            <button className="btn profile-save-inline" type="submit">
              Save branding
            </button>
          </header>
          <div className="profile-fields profile-fields-grid profile-branding-fields">
            <label className="profile-plain-field">
              App name
              <input
                value={branding.appName}
                onChange={(event) =>
                  setBranding({ ...branding, appName: event.target.value })
                }
                maxLength={80}
              />
            </label>
            <label className="profile-plain-field">
              Tagline
              <input
                value={branding.tagline}
                onChange={(event) =>
                  setBranding({ ...branding, tagline: event.target.value })
                }
                maxLength={200}
              />
            </label>
            <label className="profile-plain-field profile-color-field">
              Primary color
              <span className="profile-color-row">
                <input
                  type="color"
                  value={branding.primaryColor}
                  onChange={(event) =>
                    setBranding({ ...branding, primaryColor: event.target.value })
                  }
                />
                <code>{branding.primaryColor}</code>
              </span>
            </label>
          </div>
          {brandingSaved ? <p className="ok profile-inline-ok">{brandingSaved}</p> : null}
          <div className="profile-sheet-actions profile-sheet-actions-mobile">
            <button className="btn" type="submit">
              Save branding
            </button>
          </div>
        </form>
      ) : null}

      {canManageWorkspace && branding ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <p className="eyebrow">Workspace</p>
            <h2>Custom emoji</h2>
            <p className="muted">
              Add workspace shortcodes (like <code>:shipit:</code>) that appear in
              the reaction picker.
            </p>
          </header>
          <form className="profile-fields profile-fields-grid" onSubmit={(event) => void addCustomEmoji(event)}>
            <label className="profile-plain-field">
              Shortcode
              <input
                value={customEmojiDraft.shortcode}
                onChange={(event) =>
                  setCustomEmojiDraft((draft) => ({
                    ...draft,
                    shortcode: event.target.value,
                  }))
                }
                placeholder="shipit"
                maxLength={32}
              />
            </label>
            <label className="profile-plain-field">
              Emoji (optional if uploading image)
              <input
                value={customEmojiDraft.emoji}
                onChange={(event) =>
                  setCustomEmojiDraft((draft) => ({
                    ...draft,
                    emoji: event.target.value,
                  }))
                }
                placeholder="🚀"
                maxLength={16}
              />
            </label>
            <label className="profile-plain-field">
              Or upload image
              <input
                type="file"
                accept="image/png,image/gif,image/webp,image/jpeg"
                onChange={(event) =>
                  setCustomEmojiDraft((draft) => ({
                    ...draft,
                    imageFile: event.target.files?.[0] ?? null,
                  }))
                }
              />
            </label>
            <div className="profile-sheet-actions">
              <button className="btn" type="submit" disabled={customEmojiBusy}>
                {customEmojiBusy ? 'Saving…' : 'Add emoji'}
              </button>
            </div>
          </form>
          {(branding.customEmojis ?? []).length === 0 ? (
            <p className="muted">No custom emoji yet.</p>
          ) : (
            <ul className="member-list">
              {(branding.customEmojis ?? []).map((row) => (
                <li key={row.shortcode}>
                  <span>
                    {row.imageUrl ? (
                      <img
                        src={row.imageUrl}
                        alt={`:${row.shortcode}:`}
                        width={24}
                        height={24}
                        style={{ verticalAlign: 'middle' }}
                      />
                    ) : (
                      <strong style={{ fontSize: '1.25rem' }}>{row.emoji}</strong>
                    )}{' '}
                    <code>:{row.shortcode}:</code>
                  </span>
                  <button
                    className="ghost"
                    type="button"
                    disabled={customEmojiBusy}
                    onClick={() =>
                      void saveCustomEmojis(
                        (branding.customEmojis ?? []).filter(
                          (item) => item.shortcode !== row.shortcode,
                        ),
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {customEmojiSaved ? (
            <p className="ok profile-inline-ok">{customEmojiSaved}</p>
          ) : null}
        </section>
      ) : null}

      {canManageWorkspace ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <p className="eyebrow">Workspace</p>
            <h2>Slash commands</h2>
            <p className="muted">
              Built-ins: <code>/shrug</code>, <code>/me</code>,{' '}
              <code>/status</code>, <code>/help</code>. Add custom commands with
              a template — use <code>{'{text}'}</code> for the rest of the line.
            </p>
          </header>
          <form
            className="profile-fields profile-fields-grid"
            onSubmit={(event) => void createSlashCommand(event)}
          >
            <label className="profile-plain-field">
              Command
              <input
                value={slashDraft.name}
                onChange={(event) =>
                  setSlashDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
                placeholder="deploy"
                maxLength={32}
                required
              />
            </label>
            <label className="profile-plain-field">
              Description
              <input
                value={slashDraft.description}
                onChange={(event) =>
                  setSlashDraft((draft) => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
                placeholder="Announce a deploy"
                maxLength={160}
                required
              />
            </label>
            <label className="profile-plain-field" style={{ gridColumn: '1 / -1' }}>
              Response template
              <input
                value={slashDraft.responseTemplate}
                onChange={(event) =>
                  setSlashDraft((draft) => ({
                    ...draft,
                    responseTemplate: event.target.value,
                  }))
                }
                placeholder="Shipping: {text}"
                maxLength={2000}
                required
              />
            </label>
            <div className="profile-sheet-actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn" type="submit" disabled={slashBusy}>
                {slashBusy ? 'Creating…' : 'Add command'}
              </button>
            </div>
          </form>
          <ul className="member-list" style={{ marginTop: 12 }}>
            {slashCommands.map((command) => (
              <li key={command.id}>
                <div className="member-identity">
                  <span>
                    /{command.name}
                    {command.builtin ? ' · built-in' : ''}
                  </span>
                  <small>{command.description}</small>
                </div>
                <div className="member-actions">
                  {!command.builtin ? (
                    <button
                      type="button"
                      className="ghost danger-text"
                      onClick={() => void revokeSlashCommand(command)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {slashSaved ? (
            <p className="ok profile-inline-ok">{slashSaved}</p>
          ) : null}
        </section>
      ) : null}

      {canManageWorkspace ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <p className="eyebrow">Workspace</p>
            <h2>User groups</h2>
            <p className="muted">
              Mention <code>@handle</code> in a channel to notify that group’s
              members (like <code>@channel</code>). Handles start with a letter;
              letters, numbers, and underscores only.
            </p>
          </header>
          <form
            className="profile-fields profile-fields-grid"
            onSubmit={(event) => void saveUserGroup(event)}
          >
            <label className="profile-plain-field">
              Handle
              <input
                value={userGroupDraft.handle}
                onChange={(event) =>
                  setUserGroupDraft((draft) => ({
                    ...draft,
                    handle: event.target.value,
                  }))
                }
                placeholder="eng"
                maxLength={32}
                required
              />
            </label>
            <label className="profile-plain-field">
              Display name
              <input
                value={userGroupDraft.name}
                onChange={(event) =>
                  setUserGroupDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
                placeholder="Engineering"
                maxLength={80}
                required
              />
            </label>
            <label
              className="profile-plain-field"
              style={{ gridColumn: '1 / -1' }}
            >
              Description
              <input
                value={userGroupDraft.description}
                onChange={(event) =>
                  setUserGroupDraft((draft) => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional"
                maxLength={240}
              />
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              <p className="muted" style={{ marginBottom: 8 }}>
                {userGroupDraft.memberIds.length === 0
                  ? 'Select at least one member'
                  : `${userGroupDraft.memberIds.length} member${
                      userGroupDraft.memberIds.length === 1 ? '' : 's'
                    }`}
              </p>
              <PeoplePicker
                people={people}
                mode="multi"
                selected={userGroupDraft.memberIds}
                onToggle={toggleUserGroupMember}
              />
            </div>
            <div
              className="profile-sheet-actions"
              style={{ gridColumn: '1 / -1' }}
            >
              <button
                className="btn"
                type="submit"
                disabled={
                  userGroupBusy ||
                  !userGroupDraft.handle.trim() ||
                  !userGroupDraft.name.trim() ||
                  userGroupDraft.memberIds.length === 0
                }
              >
                {userGroupBusy
                  ? 'Saving…'
                  : editingUserGroupId
                    ? 'Save group'
                    : 'Create group'}
              </button>
              {editingUserGroupId ? (
                <button
                  className="ghost"
                  type="button"
                  onClick={() => resetUserGroupDraft()}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
          <ul className="member-list" style={{ marginTop: 12 }}>
            {userGroups.map((group) => (
              <li key={group.id}>
                <div className="member-identity">
                  <span>@{group.handle}</span>
                  <small>
                    {group.name}
                    {group.description ? ` — ${group.description}` : ''} ·{' '}
                    {group.memberIds.length} member
                    {group.memberIds.length === 1 ? '' : 's'}
                    {group.memberIds.length > 0
                      ? `: ${group.memberIds
                          .slice(0, 4)
                          .map((id) =>
                            displayName(
                              people.find((person) => person.userId === id),
                            ),
                          )
                          .join(', ')}${
                          group.memberIds.length > 4 ? '…' : ''
                        }`
                      : ''}
                  </small>
                </div>
                <div className="member-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => startEditUserGroup(group)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost danger-text"
                    onClick={() => void deleteUserGroup(group)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {userGroups.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No user groups yet.
            </p>
          ) : null}
          {userGroupSaved ? (
            <p className="ok profile-inline-ok">{userGroupSaved}</p>
          ) : null}
        </section>
      ) : null}

      {canManageWorkspace ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <p className="eyebrow">Workspace</p>
            <h2>Members</h2>
            <p className="muted">
              Manage roles in {activeOrg?.name ?? 'this workspace'}. Owners can
              transfer ownership; admins can promote/demote members.
            </p>
          </header>
          {membersBusy ? <p className="muted">Loading members…</p> : null}
          {!membersBusy && members.length === 0 ? (
            <p className="muted">No members found.</p>
          ) : null}
          <ul className="member-list">
            {members.map((member) => {
              const label = member.label || member.userId.slice(0, 8);
              const isSelf = member.userId === session?.user.id;
              const isOwnerRow = member.role === 'owner';
              return (
                <li key={member.userId}>
                  <div className="member-identity">
                    <span>{label}</span>
                    <small>
                      {member.role}
                      {isSelf ? ' · you' : ''}
                    </small>
                  </div>
                  <div className="member-actions">
                    {!isOwnerRow && isWorkspaceOwner ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          void transferOwnershipTo(member.userId, label)
                        }
                      >
                        Make owner
                      </button>
                    ) : null}
                    {!isOwnerRow && isWorkspaceOwner && !isSelf ? (
                      member.role === 'admin' ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            void changeMemberRole(member.userId, 'member')
                          }
                        >
                          Demote
                        </button>
                      ) : member.role === 'guest' ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            void changeMemberRole(member.userId, 'member')
                          }
                        >
                          Make member
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() =>
                              void changeMemberRole(member.userId, 'admin')
                            }
                          >
                            Make admin
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() =>
                              void changeMemberRole(member.userId, 'guest')
                            }
                          >
                            Make guest
                          </button>
                        </>
                      )
                    ) : null}
                    {!isOwnerRow && !isSelf && canManageWorkspace ? (
                      <button
                        type="button"
                        className="danger-text"
                        onClick={() => void kickMember(member.userId, label)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {canManageInvites ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <p className="eyebrow">Workspace</p>
            <h2>Invite people to {activeOrg?.name ?? 'this workspace'}</h2>
            <p className="muted">
              Full members join <strong>#general</strong>. Guests only see
              channels they are invited to and do not use billed seats.
            </p>
          </header>
          <form className="invite-form" onSubmit={(event) => void createInvite(event)}>
          <label>
              Email
              <input
                name="email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@yopmail.com"
                autoComplete="email"
                required
                aria-invalid={inviteEmailInvalid}
              />
              {inviteEmailInvalid ? (
                <small className="field-error">Enter a valid email address</small>
              ) : null}
          </label>
          <label>
              Role
              <select
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as 'member' | 'guest')
                }
              >
                <option value="member">Member</option>
                <option value="guest">Guest</option>
              </select>
          </label>
            <label>
              Expires in days
              <input name="expiresInDays" type="number" min="1" max="90" defaultValue="7" required />
            </label>
            <label>
              Maximum uses
              <input name="maxUses" type="number" min="1" max="500" defaultValue="1" required />
            </label>
            <button
              className="btn"
              type="submit"
              disabled={inviteBusy || !inviteEmailValid}
            >
              {inviteBusy ? 'Creating…' : 'Create invite link'}
            </button>
          </form>
          {inviteHint ? <p className="muted">{inviteHint}</p> : null}
          {inviteUrl ? (
            <div className="invite-created">
              <a href={inviteUrl}>{inviteUrl}</a>
              <button
                className="btn ghost"
                type="button"
                onClick={() => void navigator.clipboard.writeText(inviteUrl)}
              >
                Copy link
              </button>
        </div>
          ) : null}
          <div className="invite-list">
            {invites.length === 0 ? <p className="muted invite-empty">No invites created yet.</p> : null}
            {invites.map((invite) => {
              const expired = new Date(invite.expiresAt).getTime() <= Date.now();
              return (
                <div className="invite-row" key={invite.id}>
                  <div>
                    <strong>{invite.email ?? 'Open invitation'}</strong>
                    <small>
                      {invite.usedCount}/{invite.maxUses} used · expires{' '}
                      {new Date(invite.expiresAt).toLocaleDateString()}
                      {invite.revokedAt ? ' · revoked' : expired ? ' · expired' : ''}
                    </small>
                  </div>
                  {!invite.revokedAt && !expired ? (
                    <button
                      className="danger-text"
                      type="button"
                      onClick={() => void revokeInvite(invite.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {canLeaveWorkspace && activeOrg ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <p className="eyebrow">Workspace</p>
            <h2>Leave {activeOrg.name}</h2>
            <p className="muted">
              Leave this workspace for your account. You will lose access to its
              channels and messages until someone invites you again.
              {activeOrg.role === 'owner'
                ? ' If you are the only owner, delete the workspace instead (or add another owner first).'
                : ''}
            </p>
          </header>
          <div className="profile-sheet-actions">
            <button
              className="danger"
              type="button"
              disabled={leaveBusy}
              onClick={() => {
                void (async () => {
                  if (!activeOrg.id || leaveBusy) {
                    return;
                  }
                  const ok = await confirmDialog({
                    title: 'Leave workspace',
                    message: `Leave "${activeOrg.name}"? You can rejoin later with an invite.`,
                    confirmLabel: 'Leave workspace',
                    cancelLabel: 'Cancel',
                    danger: true,
                  });
                  if (!ok) {
                    return;
                  }
                  setLeaveBusy(true);
                  setError('');
                  try {
                    await leaveOrganization(activeOrg.id);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : 'Could not leave workspace',
                    );
                    setLeaveBusy(false);
                  }
                })();
              }}
            >
              {leaveBusy ? 'Leaving…' : 'Leave workspace'}
            </button>
          </div>
        </section>
      ) : null}

      {canDeleteWorkspace && activeOrg ? (
        <section className="profile-sheet profile-danger-zone">
          <header className="profile-sheet-head">
            <p className="eyebrow">Danger zone</p>
            <h2>Delete workspace</h2>
            <p className="muted">
              Permanently delete the <strong>currently active</strong> workspace{' '}
              <strong>{activeOrg.name}</strong> (rail initials:{' '}
              <strong>
                {activeOrg.name
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase() || 'WS'}
              </strong>
              ) for everyone. Channels, messages, and members of this workspace
              will be removed. This cannot be undone.
            </p>
          </header>
          <form
            className="invite-form"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                if (!activeOrg.id || deleteBusy) {
                  return;
                }
                const ok = await confirmDialog({
                  title: 'Delete workspace',
                  message: `Delete "${activeOrg.name}" for everyone? This cannot be undone.`,
                  confirmLabel: 'Delete workspace',
                  cancelLabel: 'Cancel',
                  danger: true,
                });
                if (!ok) {
                  return;
                }
                setDeleteBusy(true);
                setError('');
                try {
                  await deleteOrganization(activeOrg.id, deleteConfirmName);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Could not delete workspace',
                  );
                  setDeleteBusy(false);
                }
              })();
            }}
          >
            <label>
              Type <strong>{activeOrg.name}</strong> to confirm
              <input
                value={deleteConfirmName}
                onChange={(event) => setDeleteConfirmName(event.target.value)}
                placeholder={activeOrg.name}
                autoComplete="off"
                required
              />
            </label>
            <button
              className="danger"
              type="submit"
              disabled={
                deleteBusy ||
                deleteConfirmName.trim().toLowerCase() !==
                  activeOrg.name.trim().toLowerCase()
              }
            >
              {deleteBusy ? 'Deleting…' : 'Delete workspace'}
            </button>
          </form>
        </section>
      ) : null}

      <section className="profile-sheet profile-sheet-compact">
        <header className="profile-sheet-head profile-sheet-head-row">
          <div>
            <h2>Blocked users</h2>
            <p className="muted">
              Review people you blocked and unblock them when you want to chat again.
            </p>
          </div>
          <button className="btn ghost" type="button" onClick={() => navigate('/blocked')}>
            Manage blocked
          </button>
        </header>
      </section>

      <section className="profile-sheet profile-sheet-compact">
        <header className="profile-sheet-head profile-sheet-head-row">
          <div>
            <h2>Product tour</h2>
            <p className="muted">Replay the guided walkthrough shown on first sign-in.</p>
          </div>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              resetDemoTour();
              navigate('/chat');
            }}
          >
            Restart demo tour
          </button>
        </header>
      </section>

      <section className="profile-sheet">
        <header className="profile-sheet-head">
          <h2>Status</h2>
          <p className="muted">
            Away, Busy, or Do not disturb — shown to teammates while you are connected.
          </p>
        </header>
        <div className="profile-fields">
          <label>
            Availability
            <select
              value={presenceDraft}
              onChange={(event) =>
                setPresenceDraft(
                  event.target.value as 'online' | 'away' | 'busy' | 'dnd',
                )
              }
            >
              <option value="online">Online (auto)</option>
              <option value="away">Away</option>
              <option value="busy">Busy</option>
              <option value="dnd">Do not disturb</option>
            </select>
          </label>
          <label>
            Custom status
            <input
              value={customStatusDraft}
              maxLength={120}
              placeholder="In a meeting…"
              onChange={(event) => setCustomStatusDraft(event.target.value)}
            />
          </label>
          <button
            className="btn"
            type="button"
            disabled={presenceBusy}
            onClick={() => {
              setPresenceBusy(true);
              void api('/chat/presence', {
                method: 'PATCH',
                body: JSON.stringify({
                  status: presenceDraft,
                  customStatus: customStatusDraft,
                }),
              })
                .then(() => setSaved('Status updated'))
                .catch((err: unknown) =>
                  setError(
                    err instanceof Error ? err.message : 'Could not update status',
                  ),
                )
                .finally(() => setPresenceBusy(false));
            }}
          >
            {presenceBusy ? 'Saving…' : 'Save status'}
          </button>
        </div>
      </section>

      <section className="profile-sheet">
        <header className="profile-sheet-head">
          <h2>Two-factor & sessions</h2>
          <p className="muted">
            Authenticator app login and active device sessions.
          </p>
        </header>
        <div className="profile-fields">
          <p>
            Status:{' '}
            <strong>{totpEnabled ? '2FA enabled' : '2FA off'}</strong>
          </p>
          {!totpEnabled ? (
            <>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => {
                  void api<{ secret: string; otpauthUrl: string }>(
                    '/auth/2fa/setup',
                    { method: 'POST', body: '{}' },
                  )
                    .then((response) => setTotpSetup(response.data))
                    .catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : 'Could not start 2FA',
                      ),
                    );
                }}
              >
                Set up authenticator
              </button>
              {totpSetup ? (
                <div>
                  <p className="muted">
                    Add this secret in your authenticator app, then confirm:
                  </p>
                  <code>{totpSetup.secret}</code>
                  {totpSetup.otpauthUrl ? (
                    <p className="muted" style={{ wordBreak: 'break-all' }}>
                      {totpSetup.otpauthUrl}
                    </p>
                  ) : null}
                  <label>
                    Code
                    <input
                      value={totpCode}
                      onChange={(event) => setTotpCode(event.target.value)}
                      maxLength={6}
                      inputMode="numeric"
                    />
                  </label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      void api('/auth/2fa/confirm', {
                        method: 'POST',
                        body: JSON.stringify({ code: totpCode }),
                      })
                        .then(() => {
                          setTotpEnabled(true);
                          setTotpSetup(null);
                          setTotpCode('');
                          setSaved('Two-factor authentication enabled');
                        })
                        .catch((err: unknown) =>
                          setError(
                            err instanceof Error
                              ? err.message
                              : 'Invalid code',
                          ),
                        );
                    }}
                  >
                    Confirm 2FA
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <button
              className="ghost"
              type="button"
              onClick={() => {
                void (async () => {
                  const password = await promptDialog({
                    title: 'Disable two-factor authentication',
                    message: 'Enter your password to disable 2FA',
                    inputType: 'password',
                    confirmLabel: 'Disable',
                    placeholder: 'Password',
                  });
                  if (!password) return;
                  try {
                    await api('/auth/2fa/disable', {
                      method: 'POST',
                      body: JSON.stringify({ password }),
                    });
                    setTotpEnabled(false);
                    setSaved('Two-factor authentication disabled');
                  } catch (err: unknown) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : 'Could not disable 2FA',
                    );
                  }
                })();
              }}
            >
              Disable 2FA
            </button>
          )}
          <ul className="member-list">
            {sessions.map((item) => (
              <li key={item.id}>
                <span>
                  {item.current ? 'This device · ' : ''}
                  {item.userAgent?.slice(0, 64) || 'Unknown device'}
                  {item.ip ? ` · ${item.ip}` : ''}
                </span>
                {!item.current ? (
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      void api(`/auth/sessions/${item.id}`, {
                        method: 'DELETE',
                      }).then(() =>
                        setSessions((current) =>
                          current.filter((row) => row.id !== item.id),
                        ),
                      );
                    }}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              const refreshToken = getSession()?.refreshToken;
              void api('/auth/sessions/revoke-others', {
                method: 'POST',
                body: JSON.stringify({ refreshToken }),
              }).then(() =>
                setSessions((current) => current.filter((row) => row.current)),
              );
            }}
          >
            Sign out other sessions
          </button>
        </div>
      </section>

      {isWorkspaceOwner && activeOrganizationId ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <h2>Plan & SSO</h2>
            <p className="muted">
              Seat limits and OIDC single sign-on (requires Pro or Enterprise;
              SAML is not available yet).
            </p>
          </header>
          <div className="profile-fields">
            <p>
              Plan: <strong>{activeOrg?.plan ?? planDraft}</strong>
            </p>
            <p>
              Seats: {activeOrg?.seatCount ?? '—'} / {activeOrg?.maxSeats ?? '—'}
            </p>
            <label>
              Plan
              <select
                value={planDraft}
                onChange={(event) =>
                  setPlanDraft(
                    event.target.value as 'free' | 'pro' | 'enterprise',
                  )
                }
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </label>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void api(`/organizations/${activeOrganizationId}/billing`, {
                  method: 'PATCH',
                  body: JSON.stringify({ plan: planDraft }),
                })
                  .then(() => {
                    setSaved('Billing plan updated');
                    void refreshOrganizations();
                  })
                  .catch((err: unknown) =>
                    setError(
                      err instanceof Error
                        ? err.message
                        : 'Could not update plan',
                    ),
                  );
              }}
            >
              Save plan
            </button>
            <div className="profile-fields" style={{ marginTop: '0.75rem' }}>
              <p className="muted">
                Upgrade with Stripe Checkout, then manage payment method,
                invoices, and cancellation in the Customer Portal.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void api<{ url: string }>(
                      `/organizations/${activeOrganizationId}/billing/checkout`,
                      {
                        method: 'POST',
                        body: JSON.stringify({ plan: 'pro' }),
                      },
                    )
                      .then((res) => {
                        if (res.data?.url) {
                          window.location.href = res.data.url;
                          return;
                        }
                        setError('Checkout did not return a URL');
                      })
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Stripe checkout unavailable',
                        ),
                      );
                  }}
                >
                  Upgrade with Stripe — Pro
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void api<{ url: string }>(
                      `/organizations/${activeOrganizationId}/billing/checkout`,
                      {
                        method: 'POST',
                        body: JSON.stringify({ plan: 'enterprise' }),
                      },
                    )
                      .then((res) => {
                        if (res.data?.url) {
                          window.location.href = res.data.url;
                          return;
                        }
                        setError('Checkout did not return a URL');
                      })
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Stripe checkout unavailable',
                        ),
                      );
                  }}
                >
                  Upgrade with Stripe — Enterprise
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    void api<{ url: string }>(
                      `/organizations/${activeOrganizationId}/billing/portal`,
                      { method: 'POST', body: JSON.stringify({}) },
                    )
                      .then((res) => {
                        if (res.data?.url) {
                          window.location.href = res.data.url;
                          return;
                        }
                        setError('Billing portal did not return a URL');
                      })
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Billing portal unavailable',
                        ),
                      );
                  }}
                >
                  Manage billing in Stripe
                </button>
              </div>
            </div>
            <label>
              <input
                type="checkbox"
                checked={ssoDraft.ssoEnabled}
                disabled={
                  (activeOrg?.plan ?? planDraft) === 'free' &&
                  !ssoDraft.ssoEnabled
                }
                onChange={(event) =>
                  setSsoDraft((current) => ({
                    ...current,
                    ssoEnabled: event.target.checked,
                  }))
                }
              />{' '}
              Enable SSO
            </label>
            {(activeOrg?.plan ?? planDraft) === 'free' ? (
              <p className="muted">
                Upgrade to Pro or Enterprise to enable workspace SSO.
              </p>
            ) : null}
            <label>
              Provider
              <select
                value={ssoDraft.ssoProvider}
                onChange={(event) =>
                  setSsoDraft((current) => ({
                    ...current,
                    ssoProvider: event.target.value as 'oidc' | 'saml',
                  }))
                }
              >
                <option value="oidc">OIDC</option>
                <option value="saml">SAML</option>
              </select>
            </label>
            <label>
              Issuer URL
              <input
                value={ssoDraft.ssoIssuerUrl}
                onChange={(event) =>
                  setSsoDraft((current) => ({
                    ...current,
                    ssoIssuerUrl: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Client ID
              <input
                value={ssoDraft.ssoClientId}
                onChange={(event) =>
                  setSsoDraft((current) => ({
                    ...current,
                    ssoClientId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Client secret
              <input
                type="password"
                value={ssoDraft.ssoClientSecret}
                placeholder="Leave blank to keep existing"
                onChange={(event) =>
                  setSsoDraft((current) => ({
                    ...current,
                    ssoClientSecret: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="btn"
              type="button"
              onClick={() => {
                const payload: Record<string, unknown> = {
                  ssoEnabled: ssoDraft.ssoEnabled,
                  ssoProvider: ssoDraft.ssoProvider,
                  ssoIssuerUrl: ssoDraft.ssoIssuerUrl,
                  ssoClientId: ssoDraft.ssoClientId,
                };
                if (ssoDraft.ssoClientSecret.trim()) {
                  payload.ssoClientSecret = ssoDraft.ssoClientSecret.trim();
                }
                void api(`/organizations/${activeOrganizationId}/sso`, {
                  method: 'PATCH',
                  body: JSON.stringify(payload),
                })
                  .then(() => {
                    setSsoDraft((current) => ({
                      ...current,
                      ssoClientSecret: '',
                    }));
                    setSaved('SSO settings saved');
                  })
                  .catch((err: unknown) =>
                    setError(
                      err instanceof Error
                        ? err.message
                        : 'Could not save SSO',
                    ),
                  );
              }}
            >
              Save SSO
            </button>
            <p className="muted">
              Redirect URI for your IdP: <code>/api/auth/sso/callback</code>{' '}
              (prepend your public API base URL). Client secret is write-only.
            </p>
            <button
              className="ghost"
              type="button"
              onClick={() => {
                window.location.href = `/api/auth/sso/${activeOrganizationId}/start`;
              }}
            >
              Test SSO login
            </button>
          </div>
        </section>
      ) : null}

      <form className="profile-sheet" onSubmit={(event) => void changePassword(event)}>
        <header className="profile-sheet-head">
          <h2>Security</h2>
          <p className="muted">Updating your password signs you out so you can sign in again.</p>
        </header>

        <div className="profile-fields profile-fields-password">
          <PasswordInput
            label="Current password"
            name="currentPassword"
            required
            autoComplete="current-password"
          />
          <PasswordInput
            label="New password"
            name="newPassword"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        <div className="profile-sheet-actions">
          <button className="btn" type="submit" disabled={busy}>
          Update password
        </button>
        </div>
      </form>
    </main>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.2c1.6-3 4-4.5 6.5-4.5s4.9 1.5 6.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M8.2 4.8h2.4l1 3.2-1.5 1a12 12 0 0 0 4.9 4.9l1-1.5 3.2 1v2.4c0 .7-.5 1.3-1.2 1.4A15.5 15.5 0 0 1 4.4 6c.1-.7.7-1.2 1.4-1.2Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CakeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4v3M8 10h8v9H8zM7 19h10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 10V8.5a2 2 0 0 1 4 0V10" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5M12 8.2h.01" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
