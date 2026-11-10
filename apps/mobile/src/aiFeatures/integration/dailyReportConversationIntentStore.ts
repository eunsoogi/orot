import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { DailyReportContextRequestSchema } from '@orot/domain';
import type { DailyReportConversationIntent } from './conversationIntent';

interface SavedIntent {
  readonly intent: DailyReportConversationIntent;
  readonly active: boolean;
}
const service = 'com.orot.mobile.daily-conversation-intent.v1';

/** A serialized intent contains a date and zone only, never report or health text. */
export function createDailyReportConversationIntentStore(port: {
  read: () => Promise<SavedIntent | null>;
  write: (value: SavedIntent) => Promise<void>;
}) {
  let queue = Promise.resolve();
  let version = 0;
  const pendingDismissals = new Set<string>();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  const dismiss = (entryKey: string) => {
    pendingDismissals.add(entryKey);
    return serial(async () => {
      const saved = await port.read();
      if (saved?.active && saved.intent.entryKey === entryKey) {
        await port.write({ ...saved, active: false });
        version += 1;
      }
      pendingDismissals.delete(entryKey);
    });
  };
  return {
    read: () => serial(port.read),
    version: () => version,
    activate: (intent: DailyReportConversationIntent) =>
      serial(async () => {
        await port.write({ intent, active: true });
        version += 1;
      }),
    dismiss,
    hasPendingDismissal: (entryKey: string) => pendingDismissals.has(entryKey),
    retryDismissals: async () => {
      for (const entryKey of pendingDismissals) await dismiss(entryKey);
    },
  };
}

export const dailyReportConversationIntentStore =
  createDailyReportConversationIntentStore({
    async read() {
      const saved = await getGenericPassword({ service });
      if (!saved) return null;
      const value = JSON.parse(saved.password) as SavedIntent;
      if (
        saved.username !== 'daily-conversation' ||
        typeof value.active !== 'boolean' ||
        value.intent?.kind !== 'daily-report' ||
        typeof value.intent.entryKey !== 'string' ||
        !/^daily-conversation:[a-zA-Z0-9-]+$/.test(value.intent.entryKey) ||
        !DailyReportContextRequestSchema.safeParse(value.intent.request).success
      )
        throw new Error('Invalid daily conversation intent');
      return value;
    },
    async write(value) {
      const result = await setGenericPassword(
        'daily-conversation',
        JSON.stringify(value),
        { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
      if (!result) throw new Error('Unable to save daily conversation intent');
    },
  });
