import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';

const service = 'com.orot.mobile.daily-reminder-prompt-receipt.v1';
let writer = Promise.resolve();

/** Serialize a protected high-water receipt. Historical intents never write to this service. */
export function claimDailyReminderPrompt(deliveredAt: string) {
  const timestamp = Date.parse(deliveredAt);
  const attempt = writer.then(async () => {
    if (!Number.isSafeInteger(timestamp) || timestamp > Date.now())
      return false;
    const saved = await getGenericPassword({ service });
    if (saved) {
      const value = saved.password;
      const prior = Number(value);
      if (
        saved.username !== 'daily-reminder-prompt' ||
        !Number.isSafeInteger(prior) ||
        String(prior) !== value
      )
        throw new Error('Invalid report request receipt');
      if (timestamp <= prior) return false;
    }
    const stored = await setGenericPassword(
      'daily-reminder-prompt',
      String(timestamp),
      {
        service,
        accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    if (!stored) throw new Error('Report request receipt unavailable');
    return true;
  });
  writer = attempt.then(
    () => undefined,
    () => undefined,
  );
  return attempt;
}
