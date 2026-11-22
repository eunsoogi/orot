import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { t } from '../../i18n';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import { resetInferenceConsentReceipts } from '../../storage/inferenceConsentStorage';
import {
  captureOrdinaryConversationMemoryAdmission,
  openOrdinaryConversationMemoryOwner,
  readOrdinaryConversationMemorySettings,
} from '../../storage/ordinaryConversationMemoryDeviceOwner';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { SettingsPrivacyRoute } from '../SettingsPrivacyRoute';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../storage/inferenceConsentStorage', () => ({
  resetInferenceConsentReceipts: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const insets = { top: 0, left: 0, right: 0, bottom: 34 };
  return {
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

const service = 'com.orot.mobile.ordinary-conversation-memory-authority.v1';
type Route = 'home' | 'settings-privacy' | 'elsewhere';
type Device = Awaited<ReturnType<typeof getGenericPassword>>;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(ready => {
    resolve = ready;
  });
  return { promise, resolve };
}
function fixture(
  beforeWrite: (status: string) => Promise<void> = async () => {},
) {
  const f = openSqliteTestDatabase(':memory:');
  const device: { value: Device } = { value: false };
  const controller = createNavigationController<Route>('home');
  const write = jest.mocked(setGenericPassword);
  write.mockClear();
  write.mockImplementation(async (username, password) => {
    await beforeWrite(JSON.parse(password).status);
    const result = { service, storage: STORAGE_TYPE.AES_GCM_NO_AUTH };
    device.value = { username, password, ...result };
    return result;
  });
  jest.mocked(getGenericPassword).mockImplementation(async () => device.value);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
  return {
    ...f,
    device,
    controller,
    write,
    async open() {
      await render(
        <NavigationRouteAdapter controller={controller}>
          {actions =>
            actions.route.name === 'settings-privacy' ? (
              <SettingsPrivacyRoute ownership={actions.ownership} />
            ) : (
              <Text testID={actions.route.name}>{actions.route.name}</Text>
            )
          }
        </NavigationRouteAdapter>,
      );
      await act(async () => {
        controller.push('settings-privacy');
      });
    },
  };
}

test('real Privacy route defaults off and grants the separate local-only category only after an explicit tap', async () => {
  const f = fixture();
  try {
    await f.open();
    expect(
      await screen.findByText(t('settings.automaticMemory.off')),
    ).toBeTruthy();
    expect(f.write).not.toHaveBeenCalled();
    expect(screen.getByText(t('settings.automaticMemory.backup'))).toBeTruthy();
    expect(screen.getByTestId('settings-privacy-permissions')).toBeTruthy();
    expect(
      screen.getByTestId('settings-privacy-external-transfer'),
    ).toBeTruthy();
    expect(screen.getByTestId('inference-consent-clear')).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('settings-automatic-memory-enable'),
    );
    expect(
      await screen.findByText(t('settings.automaticMemory.on')),
    ).toBeTruthy();
    expect(await captureOrdinaryConversationMemoryAdmission()).toBeDefined();
    expect(
      f.write.mock.calls.map(([, body]) => JSON.parse(body).status),
    ).toEqual(['suspended', 'active']);
    await fireEvent.press(
      screen.getByTestId('settings-automatic-memory-disable'),
    );
    expect(
      await screen.findByText(t('settings.automaticMemory.off')),
    ).toBeTruthy();
    expect(await captureOrdinaryConversationMemoryAdmission()).toBeUndefined();
    expect(JSON.parse(f.write.mock.lastCall![1]).status).toBe('revoked');
    expect(resetInferenceConsentReceipts).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('a logical route change while native enable is held invalidates the attempt and cannot activate it on return', async () => {
  const pending = deferred();
  const entered = deferred();
  const f = fixture(async status => {
    if (status !== 'suspended') return;
    entered.resolve();
    await pending.promise;
  });
  try {
    await f.open();
    await screen.findByText(t('settings.automaticMemory.off'));
    await fireEvent.press(
      screen.getByTestId('settings-automatic-memory-enable'),
    );
    await entered.promise;
    const privacy = f.controller.getSnapshot().currentRoute;
    await act(async () => {
      f.controller.push('elsewhere');
    });
    expect(await screen.findByTestId('elsewhere')).toBeTruthy();
    await act(async () => {
      const away = f.controller.getSnapshot().currentRoute;
      expect(f.controller.reconcileNativeBack(away.key)).toBe(true);
    });
    // The same logical route returning before the native save resolves must not resurrect the old attempt.
    expect(f.controller.getSnapshot().currentRoute.key).toBe(privacy.key);
    await act(async () => {
      pending.resolve();
      await captureOrdinaryConversationMemoryAdmission();
    });
    expect(await captureOrdinaryConversationMemoryAdmission()).toBeUndefined();
    expect(
      f.write.mock.calls.map(([, body]) => JSON.parse(body).status),
    ).toEqual(['suspended']);
    await act(async () => {
      f.controller.replace('settings-privacy');
    });
    expect(
      await screen.findByText(t('settings.automaticMemory.off')),
    ).toBeTruthy();
  } finally {
    pending.resolve();
    f.close();
  }
});

test('disable immediately fences old captures but a rejected durable revocation does not display off', async () => {
  const held = deferred();
  const entered = deferred();
  const f = fixture(async status => {
    if (status !== 'revoked') return;
    entered.resolve();
    await held.promise;
    throw new Error('Synthetic native revocation refused');
  });
  try {
    await f.open();
    await screen.findByText(t('settings.automaticMemory.off'));
    await fireEvent.press(
      screen.getByTestId('settings-automatic-memory-enable'),
    );
    await screen.findByText(t('settings.automaticMemory.on'));
    const old = await captureOrdinaryConversationMemoryAdmission();
    expect(old?.isCurrent()).toBe(true);
    await fireEvent.press(
      screen.getByTestId('settings-automatic-memory-disable'),
    );
    expect(old?.isCurrent()).toBe(false);
    await entered.promise;
    await act(async () => held.resolve());
    expect(
      await screen.findByText(t('settings.automaticMemory.disableError')),
    ).toBeTruthy();
    expect(screen.queryByText(t('settings.automaticMemory.off'))).toBeNull();
    expect(screen.queryByTestId('settings-automatic-memory-enable')).toBeNull();
    expect(
      await readOrdinaryConversationMemorySettings(
        await openOrdinaryConversationMemoryOwner(),
      ),
    ).toBe('unavailable');
    expect(f.device.value && JSON.parse(f.device.value.password).status).toBe(
      'active',
    );
  } finally {
    held.resolve();
    f.close();
  }
});

test('an unreadable device decision is visible and cannot become an opt-in action', async () => {
  const f = fixture();
  f.device.value = {
    service,
    storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
    username: 'ordinary-conversation-memory-authority',
    password: '{"malformed":true}',
  };
  try {
    await f.open();
    expect(
      await screen.findByText(t('settings.automaticMemory.unavailable')),
    ).toBeTruthy();
    expect(screen.queryByTestId('settings-automatic-memory-enable')).toBeNull();
    expect(f.write).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
