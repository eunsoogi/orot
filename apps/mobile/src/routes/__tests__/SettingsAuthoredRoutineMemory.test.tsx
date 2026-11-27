import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { Alert, View } from 'react-native';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  authoredRoutineMemoryDeviceOwner,
  captureOrdinaryConversationMemoryAdmission,
} from '../../storage/ordinaryConversationMemoryDeviceOwner';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { SettingsAutomaticMemorySection } from '../SettingsAutomaticMemorySection';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const consentService = 'com.orot.mobile.authored-routine-memory-authority.v1';
const owner = { isCurrent: () => true, subscribe: () => () => {} };

test('the distinct routine switch starts off and does not silently authorize when preferences are on', async () => {
  const fixture = openSqliteTestDatabase(':memory:');
  const information = jest.spyOn(Alert, 'alert');
  const keychain = new Map<
    string,
    Awaited<ReturnType<typeof getGenericPassword>>
  >();
  const write = jest.mocked(setGenericPassword);
  write.mockReset().mockImplementation(async (username, password, options) => {
    if (!options?.service) throw new Error('Scoped service required.');
    const result = {
      service: options.service,
      storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
    };
    keychain.set(options.service, { username, password, ...result });
    return result;
  });
  jest
    .mocked(getGenericPassword)
    .mockImplementation(
      async options => keychain.get(options?.service ?? '') ?? false,
    );
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(fixture.database);
  try {
    const component = await render(
      <View>
        <SettingsAutomaticMemorySection ownership={owner} />
        <SettingsAutomaticMemorySection ownership={owner} routine />
      </View>,
    );
    try {
      expect(await screen.findByText('습관 자동 저장 꺼짐')).toBeTruthy();
      expect(screen.getByText('대화에서 기억 자동 저장')).toBeTruthy();
      expect(
        screen.queryByText(/읽기나 공부처럼 직접 말한 일부 반복 습관/),
      ).toBeNull();
      await fireEvent.press(screen.getByTestId('settings-routine-memory-info'));
      expect(information).toHaveBeenCalledWith(
        '대화에서 기억 자동 저장',
        expect.stringContaining('읽기나 공부처럼 직접 말한 일부 반복 습관'),
      );
      expect(write).not.toHaveBeenCalled();

      await fireEvent(
        screen.getByTestId('settings-automatic-memory-toggle'),
        'valueChange',
        true,
      );
      expect(await screen.findByText('켜짐')).toBeTruthy();
      expect(screen.getByText('습관 자동 저장 꺼짐')).toBeTruthy();
      expect(
        await authoredRoutineMemoryDeviceOwner.captureAdmission(),
      ).toBeUndefined();

      await fireEvent(
        screen.getByTestId('settings-routine-memory-toggle'),
        'valueChange',
        true,
      );
      expect(await screen.findByText('습관 자동 저장 켜짐')).toBeTruthy();
      const granted = await authoredRoutineMemoryDeviceOwner.captureAdmission();
      expect(granted?.scope).toBe('authored-routine');
      expect(write.mock.lastCall?.[2]).toMatchObject({
        service: consentService,
        accessible: 'device-only',
      });
      expect(
        (await captureOrdinaryConversationMemoryAdmission())?.isCurrent(),
      ).toBe(true);

      await fireEvent(
        screen.getByTestId('settings-routine-memory-toggle'),
        'valueChange',
        false,
      );
      expect(await screen.findByText('습관 자동 저장 꺼짐')).toBeTruthy();
      expect(granted?.isCurrent()).toBe(false);
      expect(
        (await captureOrdinaryConversationMemoryAdmission())?.isCurrent(),
      ).toBe(true);
    } finally {
      await component.unmount();
    }
  } finally {
    information.mockRestore();
    fixture.close();
  }
});
