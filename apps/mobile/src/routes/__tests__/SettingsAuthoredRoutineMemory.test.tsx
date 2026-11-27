import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { View } from 'react-native';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  authoredRoutineMemoryDeviceOwner,
  authoredNoteMemoryDeviceOwner,
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
        <SettingsAutomaticMemorySection ownership={owner} general />
      </View>,
    );
    try {
      expect(await screen.findByText('습관 자동 저장 꺼짐')).toBeTruthy();
      expect(screen.getByText('대화에서 기억 자동 저장')).toBeTruthy();
      expect(
        screen.getByText(/읽기나 공부처럼 직접 말한 일부 반복 습관/),
      ).toBeTruthy();
      expect(write).not.toHaveBeenCalled();

      await fireEvent.press(
        await screen.findByTestId('settings-automatic-memory-enable'),
      );
      expect(await screen.findByText('켜짐')).toBeTruthy();
      expect(screen.getByText('습관 자동 저장 꺼짐')).toBeTruthy();
      expect(
        await authoredRoutineMemoryDeviceOwner.captureAdmission(),
      ).toBeUndefined();

      await fireEvent.press(
        screen.getByTestId('settings-routine-memory-enable'),
      );
      expect(await screen.findByText('습관 자동 저장 켜짐')).toBeTruthy();
      const granted = await authoredRoutineMemoryDeviceOwner.captureAdmission();
      expect(granted?.scope).toBe('authored-routine');
      expect(screen.getByText('내가 말한 내용 자동 저장 꺼짐')).toBeTruthy();
      expect(
        await authoredNoteMemoryDeviceOwner.captureAdmission(),
      ).toBeUndefined();
      expect(write.mock.lastCall?.[2]).toMatchObject({
        service: consentService,
        accessible: 'device-only',
      });
      expect(
        (await captureOrdinaryConversationMemoryAdmission())?.isCurrent(),
      ).toBe(true);

      await fireEvent.press(
        screen.getByTestId('settings-routine-memory-disable'),
      );
      expect(await screen.findByText('습관 자동 저장 꺼짐')).toBeTruthy();
      expect(granted?.isCurrent()).toBe(false);
      await fireEvent.press(
        screen.getByTestId('settings-authored-note-memory-enable'),
      );
      expect(
        await screen.findByText('내가 말한 내용 자동 저장 켜짐'),
      ).toBeTruthy();
      const general = await authoredNoteMemoryDeviceOwner.captureAdmission();
      expect(general?.scope).toBe('authored-note');
      expect(write.mock.lastCall?.[2]).toMatchObject({
        service: 'com.orot.mobile.authored-note-memory-authority.v1',
        accessible: 'device-only',
      });
      await fireEvent.press(
        screen.getByTestId('settings-authored-note-memory-disable'),
      );
      expect(
        await screen.findByText('내가 말한 내용 자동 저장 꺼짐'),
      ).toBeTruthy();
      expect(general?.isCurrent()).toBe(false);
      expect(
        (await captureOrdinaryConversationMemoryAdmission())?.isCurrent(),
      ).toBe(true);
    } finally {
      await component.unmount();
    }
  } finally {
    fixture.close();
  }
});
