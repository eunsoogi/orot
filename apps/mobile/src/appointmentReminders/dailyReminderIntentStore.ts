import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  createDailyReportIdentity,
  DailyReportContextRequestSchema,
} from '@orot/domain';
import type { SavedDailyReminderEntry } from './dailyReminderDestination';

const service = 'com.orot.mobile.daily-reminder-intent.v1';

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
    if (entry.selectedRequest !== undefined)
      DailyReportContextRequestSchema.parse(entry.selectedRequest);
    return value;
  },
  async write(value: SavedDailyReminderEntry): Promise<void> {
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
