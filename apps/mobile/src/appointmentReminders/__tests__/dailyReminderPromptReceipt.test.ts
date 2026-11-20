import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { claimDailyReminderPrompt } from '../dailyReminderPromptReceipt';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

beforeEach(() => {
  let receipt: Awaited<ReturnType<typeof getGenericPassword>> = false;
  jest
    .mocked(getGenericPassword)
    .mockReset()
    .mockImplementation(async () => receipt);
  jest
    .mocked(setGenericPassword)
    .mockReset()
    .mockImplementation(async (username, password, options) => {
      const service = options?.service ?? '';
      const storage = STORAGE_TYPE.AES_GCM_NO_AUTH;
      receipt = { service, storage, username, password };
      return { service, storage };
    });
});

test('the protected watermark rejects A after B and only allows each strictly newer accepted timestamp once', async () => {
  const first = new Date(Date.now() - 2000).toISOString();
  const second = new Date(Date.now() - 1000).toISOString();
  expect(await claimDailyReminderPrompt(first)).toBe(true);
  expect(await claimDailyReminderPrompt(second)).toBe(true);
  expect(await claimDailyReminderPrompt(first)).toBe(false);
  expect(await claimDailyReminderPrompt(second)).toBe(false);
  expect(setGenericPassword).toHaveBeenCalledTimes(2);
});

test('protected write failure does not claim the report request', async () => {
  const delivered = new Date(Date.now() - 2000).toISOString();
  jest.mocked(setGenericPassword).mockResolvedValueOnce(false);
  await expect(claimDailyReminderPrompt(delivered)).rejects.toThrow(
    'receipt unavailable',
  );
  expect(await claimDailyReminderPrompt(delivered)).toBe(true);
});
