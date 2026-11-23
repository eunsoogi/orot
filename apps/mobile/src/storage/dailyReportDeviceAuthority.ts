import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { createConsentAuthority } from '../agent/execution/consentAuthority';
import { createConsentGeneration } from '../agent/execution/consentGeneration';

const service = 'com.orot.mobile.daily-report-link-authority.v1';
const account = 'daily-report-link-authority';

/** Only the random permission epoch stays in Keychain, never the report or its identity. */
export const dailyReportDeviceAuthority = createConsentAuthority(
  {
    async read() {
      const value = await getGenericPassword({ service });
      if (value === false || value.username !== account) return null;
      return JSON.parse(value.password) as unknown;
    },
    async write(value) {
      const saved = await setGenericPassword(account, JSON.stringify(value), {
        service,
        accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      if (!saved)
        throw new Error('Daily Report Memory authority was not saved.');
    },
  },
  createConsentGeneration,
);
