import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import {
  getGenericPassword,
  setGenericPassword,
  ACCESSIBLE,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import {
  ModelSettingsServicesContext,
  type ModelSettingsServices,
} from '../../agent/execution/ModelSettingsServices';
import { createCalendarDecisionsOption } from '../decisionsProvider';
import { calendarModelStore } from '../calendarModelStore';
import { CalendarModelSettingsPanel } from '../CalendarModelSettingsPanel';

jest.mock('react-native-keychain', () => ({
  ...jest.requireActual('react-native-keychain'),
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    ...jest
      .requireActual(
        '../../agent/execution/testSupport/modelSettingsServiceFixture',
      )
      .modelSettingsVoiceFixture(),
    consentAccountEpoch: jest.fn(),
    subscribe: jest.fn(() => () => undefined),
  },
}));

jest.mock('../calendarModelStore', () => ({
  calendarModelStore: {
    ...jest
      .requireActual(
        '../../agent/execution/testSupport/modelSettingsServiceFixture',
      )
      .modelSettingsSelectionFixture(),
  },
}));

const epoch = 'a'.repeat(64);
const apple = createAppleSelectionOption('available');
const voice = jest.mocked(voiceSettingsStore);
const saved = { providerId: 'openai-api-decisions', modelId: 'gpt-6-luna' };

function mount() {
  return render(
    <CalendarModelSettingsPanel options={[apple]} onBusyChange={jest.fn()} />,
  );
}

test('reopens the saved API row first from exact durable account cache; failed refresh does not make it selectable', async () => {
  let durable: Awaited<ReturnType<typeof getGenericPassword>> = false;
  jest.mocked(getGenericPassword).mockImplementation(async () => durable);
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (username, password, options) => {
      const service = options?.service ?? '';
      durable = {
        username,
        password,
        service,
        storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
      };
      return { service, storage: STORAGE_TYPE.AES_GCM_NO_AUTH };
    });
  voice.consentAccountEpoch.mockResolvedValue(epoch);
  voice.accountStatus.mockResolvedValue({ connected: true, revision: 1 });
  voice.discoverModels.mockResolvedValueOnce({
    revision: 1,
    ids: ['gpt-6-luna', 'unrelated'],
  });
  jest.mocked(calendarModelStore.load).mockResolvedValue(saved);
  NativeModules.CalendarDecisionsTransport = {
    post: jest.fn(),
    cancel: jest.fn(),
  };
  const first = await mount();
  await fireEvent.press(screen.getByTestId('calendar-model-refresh'));
  expect(await screen.findByText('GPT-6 Luna')).toBeTruthy();
  expect(setGenericPassword).toHaveBeenCalledWith(
    'openai-api-decisions',
    JSON.stringify({ epoch, ids: ['gpt-6-luna'] }),
    expect.objectContaining({
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  );
  await first.unmount();
  voice.discoverModels.mockClear();
  const second = await mount();
  expect(await screen.findByText('GPT-6 Luna')).toBeTruthy();
  const choices = screen.getAllByTestId(
    /^(calendar-model-group-openai-api|provider-choices-content)$/,
  );
  expect(choices[0]?.props.testID).toBe('calendar-model-group-openai-api');
  expect(screen.queryByTestId('calendar-current-model-card')).toBeNull();
  const api = () => screen.getByTestId('provider-option-1');
  expect(api().props.accessibilityState.selected).toBe(true);
  expect(api()).toBeDisabled();
  expect(voice.discoverModels).not.toHaveBeenCalled();
  voice.discoverModels.mockRejectedValueOnce(new Error('Offline'));
  await fireEvent.press(screen.getByTestId('calendar-model-refresh'));
  expect(api().props.accessibilityState.selected).toBe(true);
  expect(api()).toBeDisabled();
  await fireEvent.press(api());
  expect(screen.queryByTestId('provider-selection-confirmation')).toBeNull();
  expect(calendarModelStore.save).not.toHaveBeenCalled();

  voice.consentAccountEpoch.mockResolvedValue('b'.repeat(64));
  await act(async () => voice.subscribe.mock.calls.at(-1)?.[0]());
  expect(screen.queryByText('GPT-6 Luna')).toBeNull();
  await second.unmount();
  await mount();
  await waitFor(() =>
    expect(screen.getByTestId('calendar-model-refresh')).not.toBeDisabled(),
  );
  expect(screen.queryByText('GPT-6 Luna')).toBeNull();
  expect(voice.consentAccountEpoch).toHaveBeenCalledWith(false);
});

test.each([true, false])(
  'an already approved API selection may be shown with a check before the first catalog, not activated: %s',
  async approved => {
    jest.mocked(getGenericPassword).mockResolvedValue(false);
    jest.mocked(setGenericPassword).mockClear();
    voice.accountStatus.mockResolvedValue({ connected: true, revision: 1 });
    voice.discoverModels.mockClear();
    const saveConsent = jest.fn();
    const reuseApproval: NonNullable<ModelSettingsServices['reuseApproval']> =
      jest.fn(
        async ({ option, slot, signal, isCurrent }, store) =>
          approved &&
          slot === 'calendar' &&
          isCurrent() &&
          !signal.aborted &&
          option.provider.id === saved.providerId &&
          option.modelId === saved.modelId &&
          store === calendarModelStore,
      );
    const services: ModelSettingsServices = {
      voice,
      calendar: calendarModelStore,
      calendarOption: createCalendarDecisionsOption,
      reuseApproval,
      saveConsent,
    };
    await render(
      <ModelSettingsServicesContext.Provider value={services}>
        <CalendarModelSettingsPanel
          options={[apple]}
          onBusyChange={jest.fn()}
        />
      </ModelSettingsServicesContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('calendar-model-refresh')).not.toBeDisabled(),
    );
    expect(reuseApproval).toHaveBeenCalledTimes(1);
    if (approved) {
      const row = screen.getByTestId('provider-option-1');
      expect(row.props.accessibilityState.selected).toBe(true);
      expect(row).toBeDisabled();
      await fireEvent.press(row);
    } else expect(screen.queryByText('GPT-6 Luna')).toBeNull();
    expect(voice.discoverModels).not.toHaveBeenCalled();
    expect(saveConsent).not.toHaveBeenCalled();
    expect(setGenericPassword).not.toHaveBeenCalled();
  },
);
