import { setGenericPassword, getGenericPassword } from 'react-native-keychain';

/** Test fixed authority changes without native Keychain or product data. */
export function dailyReportDeviceAuthorityFixture() {
  let device:
    | { username: string; password: string; service: string; storage: string }
    | false = false;
  jest
    .mocked(getGenericPassword)
    .mockImplementation(async () => device as never);
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (username, password, options) => {
      expect(options?.accessible).toBe('device-only');
      device = {
        username,
        password,
        service: options?.service ?? '',
        storage: 'mock',
      };
      return device as never;
    });
  return {
    lose() {
      device = false;
    },
  };
}
