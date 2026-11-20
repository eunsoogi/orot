import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  createDailyReportIdentity,
  DailyReportContextRequestSchema,
} from '@orot/domain';
import type { DailyReminderEntry } from './dailyReminderDelivery';
import type { SavedDailyReminderEntry } from './dailyReminderDestination';

const service = 'com.orot.mobile.daily-reminder-intent.v1';

/** Reject malformed or expanded metadata rather than silently rebinding an existing intent. */
export function validDailyReminderConversationOwner(
  value: unknown,
): value is NonNullable<DailyReminderEntry['conversationOwner']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return (
    Object.keys(owner).sort().join(',') === 'createdAt,id,version' &&
    typeof owner.id === 'string' &&
    owner.id.trim().length > 0 &&
    Number.isSafeInteger(owner.version) &&
    // Fresh retained sessions begin at zero; only negative generations are invalid.
    Number(owner.version) >= 0 &&
    typeof owner.createdAt === 'string' &&
    Number.isFinite(Date.parse(owner.createdAt))
  );
}

/** Stores only a notification identity and observed date context, never health content. */
export const dailyReminderIntentStore = {
  async read(): Promise<SavedDailyReminderEntry | null> {
    const saved = await getGenericPassword({ service });
    if (!saved) return null;
    const value = JSON.parse(saved.password) as SavedDailyReminderEntry;
    const entry = value.entry;
    if (
      saved.username !== 'daily-reminder' ||
      typeof value.active !== 'boolean' ||
      entry?.kind !== 'daily_report' ||
      typeof entry.entryKey !== 'string' ||
      !/^daily-reminder:\d+(\.\d+)?$/.test(entry.entryKey) ||
      typeof entry.deliveredAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.deliveredAt)) ||
      entry.deliveryTimeZone !== 'unknown'
    )
      throw new Error('Invalid reminder intent');
    createDailyReportIdentity(
      entry.dateInObservedTimeZone,
      entry.observedTimeZone,
    );
    if (
      entry.conversationOwner !== undefined &&
      !validDailyReminderConversationOwner(entry.conversationOwner)
    )
      throw new Error('Invalid reminder conversation owner');
    if (entry.selectedRequest !== undefined)
      DailyReportContextRequestSchema.parse(entry.selectedRequest);
    return value;
  },
  async write(value: SavedDailyReminderEntry): Promise<void> {
    if (
      value.entry.conversationOwner !== undefined &&
      !validDailyReminderConversationOwner(value.entry.conversationOwner)
    )
      throw new Error('Invalid reminder conversation owner');
    const result = await setGenericPassword(
      'daily-reminder',
      JSON.stringify(value),
      {
        service,
        accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    if (!result) throw new Error('Unable to save reminder intent');
  },
};
