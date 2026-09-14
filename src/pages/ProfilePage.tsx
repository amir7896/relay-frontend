import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useOrganization } from '../organizations/OrganizationContext';
import { useConfirm } from '../components/ConfirmProvider';
import { PasswordInput } from '../components/PasswordInput';
import { resolveMediaUrl } from '../components/VoiceNotePlayer';
import { initials } from '../lib/format';
import {
  getNotificationPermission,
  subscribeWebPush,
} from '../lib/notifications';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { resetDemoTour } from '../components/DemoTour';
import type { UserProfile, WorkspaceSettings } from '../api/types';

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
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState(() => getNotificationPermission());
  const [notifyHint, setNotifyHint] = useState('');
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
    setNotifyStatus(getNotificationPermission());
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
      .then((response) => setBranding(response.data))
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
        body: JSON.stringify(branding),
      });
      setBranding(response.data);
      document.documentElement.style.setProperty('--brand', response.data.primaryColor);
      setBrandingSaved('Workspace branding saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save branding');
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

  async function changeMemberRole(userId: string, role: 'admin' | 'member') {
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
            Alerts for new messages when Relay is in the background. Muted chats stay quiet.
          </p>
        </header>
        <div className="profile-notify">
          <div className="profile-notify-row">
            <p className="profile-notify-status">
              Status{' '}
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
              To turn them off, use your browser site settings for this page.
            </p>
          ) : null}
          {notifyStatus === 'denied' ? (
            <p className="muted">
              Relay cannot ask again after a browser block. Allow notifications in the address-bar
              site settings, then refresh.
            </p>
          ) : null}
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
                      ) : (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            void changeMemberRole(member.userId, 'admin')
                          }
                        >
                          Make admin
                        </button>
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
              Enter a teammate’s email to create an invite for this workspace and{' '}
              <strong>#general</strong>. When SMTP is configured the link is
              emailed; otherwise copy the link (works with YOPmail too).
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
