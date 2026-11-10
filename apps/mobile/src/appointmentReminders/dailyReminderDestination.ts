import type { DailyReminderEntry } from './dailyReminderDelivery';
import { DailyReportContextRequestSchema } from '@orot/domain';
import type { DailyReportContextRequest } from '@orot/domain';

export interface SavedDailyReminderEntry {
  readonly entry: DailyReminderEntry;
  readonly active: boolean;
}

/** Serialize durable intent, navigation and dismissal across duplicate delivery and restart. */
export function createDailyReminderDestination(port: {
  read: () => Promise<SavedDailyReminderEntry | null>;
  write: (value: SavedDailyReminderEntry) => Promise<void>;
  open: (
    entry: DailyReminderEntry,
  ) =>
    | 'opened'
    | 'busy'
    | 'unavailable'
    | 'declined'
    | Promise<'opened' | 'busy' | 'unavailable' | 'declined'>;
  canOpen?: (entry: DailyReminderEntry) => boolean;
}) {
  let queue = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    accept: (entry: DailyReminderEntry) =>
      serial(async () => {
        const previous = await port.read();
        if (previous?.entry.entryKey === entry.entryKey && !previous.active)
          return 'opened' as const;
        // Keep a second tap in the native inbox while an earlier report route is active.
        if (port.canOpen && !port.canOpen(entry)) return 'busy' as const;
        // Save before navigation: a crash before inbox acknowledgement can restore this intent.
        if (previous?.entry.entryKey !== entry.entryKey)
          await port.write({ entry, active: true });
        const result = await port.open(
          previous?.entry.entryKey === entry.entryKey ? previous.entry : entry,
        );
        if (result === 'declined') {
          await port.write({
            entry:
              previous?.entry.entryKey === entry.entryKey
                ? previous.entry
                : entry,
            active: false,
          });
          return 'opened' as const;
        }
        return result;
      }),
    restore: () =>
      serial(async () => {
        const previous = await port.read();
        if (!previous?.active) return 'opened' as const;
        const decision = await port.open(previous.entry);
        if (decision === 'declined') {
          await port.write({ ...previous, active: false });
          return decision;
        }
        return decision;
      }),
    dismiss: (entryKey: string) =>
      serial(async () => {
        const previous = await port.read();
        if (previous?.active && previous.entry.entryKey === entryKey)
          await port.write({ ...previous, active: false });
      }),
    select: (entryKey: string, request: DailyReportContextRequest) =>
      serial(async () => {
        const previous = await port.read();
        if (!previous?.active || previous.entry.entryKey !== entryKey)
          throw new Error('Daily reminder is no longer active');
        const entry = {
          ...previous.entry,
          selectedRequest: DailyReportContextRequestSchema.parse(request),
        };
        await port.write({ entry, active: true });
        return entry;
      }),
    alreadyHandled: (entry: DailyReminderEntry) =>
      serial(async () => {
        const previous = await port.read();
        return previous?.entry.entryKey === entry.entryKey && !previous.active;
      }),
  };
}
