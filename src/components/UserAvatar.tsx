import { initials } from '../lib/format';
import { resolveMediaUrl } from './VoiceNotePlayer';
import type { UserProfile } from '../api/types';

type UserAvatarProps = {
  profile?: UserProfile | null;
  name?: string;
  /** Direct image URL (e.g. incoming webhook bot icon). */
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
};

export function UserAvatar({
  profile,
  name,
  imageUrl,
  size = 'sm',
  className = '',
}: UserAvatarProps) {
  const label =
    name?.trim() ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
    profile?.email ||
    '?';
  const src = imageUrl?.trim()
    ? resolveMediaUrl(imageUrl.trim())
    : profile?.avatar?.trim()
      ? resolveMediaUrl(profile.avatar.trim())
      : '';

  if (src) {
    return (
      <img
        className={`avatar ${size}${className ? ` ${className}` : ''}`}
        src={src}
        alt=""
      />
    );
  }

  return (
    <span className={`avatar ${size}${className ? ` ${className}` : ''}`}>
      {initials(label)}
    </span>
  );
}
