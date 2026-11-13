import Graphemer from 'graphemer';
import { t } from '../i18n';

export const avatarIds = ['neutral', 'sun', 'leaf', 'star'] as const;
export type AvatarId = (typeof avatarIds)[number];
export type AssistantAppearance = Readonly<{
  avatar: AvatarId;
  name: string | null;
}>;
export const defaultAssistantName = t('assistantAppearance.defaultName');
export const maximumNameGraphemes = 24;
const splitter = new Graphemer();

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && avatarIds.some(id => id === value);
}

/** Validate without truncation; keep the pending text intact for correction. */
export function normalizeAssistantName(value: string): string | null {
  if (/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) throw new Error('characters');
  const trimmed = value.trim();
  if (splitter.countGraphemes(trimmed) > maximumNameGraphemes)
    throw new Error('length');
  return trimmed || null;
}

/** A legacy avatar without a name remains configured; unknown IDs never do. */
export function parseAppearance(value: string): AssistantAppearance | null {
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const record = data as Record<string, unknown>;
    if (!isAvatarId(record.avatar)) return null;
    if (record.name != null && typeof record.name !== 'string') return null;
    const name = normalizeAssistantName((record.name as string | null) ?? '');
    return { avatar: record.avatar, name };
  } catch {
    return null;
  }
}
