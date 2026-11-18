import { fireEvent, render, screen } from '@testing-library/react-native';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import {
  loadPrivateCloudComputeOption,
  APPLE_PCC_MODEL_ID,
} from '../privateCloudCompute';
import { applePrivateCloudComputeProvider } from '../../apple';
import { calendarModelStore } from '../../../calendarModelSettings/calendarModelStore';
import { voiceSettingsStore } from '../../../voiceSettings/voiceSettingsStore';
import { t } from '../../../i18n';

jest.mock('../../../calendarModelSettings/calendarModelStore', () => ({
  calendarModelStore: { load: jest.fn(async () => null), save: jest.fn() },
}));
jest.mock('../../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    load: jest.fn(async () => ({
      mode: 'local',
      model: 'apple-system-speech',
      hasApiKey: false,
    })),
    save: jest.fn(),
    accountStatus: jest.fn(async () => ({ connected: false, revision: 1 })),
    discoverModels: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it('keeps denied cloud choices visible and disabled in language/calendar while preserving real voice choices', async () => {
  jest
    .spyOn(applePrivateCloudComputeProvider, 'getAvailability')
    .mockResolvedValue({ status: 'entitlementRequired' });
  const option = await loadPrivateCloudComputeOption();
  const save = jest.fn();
  await render(
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[
        option,
        {
          ...option,
          displayName: 'Synthetic connected model',
          modelId: 'synthetic-connected',
          availability: {
            status: 'unavailable',
            message: 'Synthetic unavailable',
          },
          provider: { ...option.provider, id: 'synthetic-remote' },
        },
      ]}
      requirements={{ inputTypes: ['text'] }}
      selectionStore={{ load: async () => null, save, clear: jest.fn() }}
    />,
  );
  for (const tab of ['language', 'calendar']) {
    await fireEvent.press(screen.getByTestId('model-tab-' + tab));
    expect(screen.getByText('Apple Intelligence')).toBeTruthy();
    expect(screen.getByText('Synthetic connected model')).toBeTruthy();
    expect(screen.getByText('Private Cloud Compute에서 처리')).toBeTruthy();
    expect(screen.getByText('사용 승인을 받지 못했어요.')).toBeTruthy();
    expect(screen.queryByText(APPLE_PCC_MODEL_ID)).toBeNull();
    expect(
      screen.queryByText(t('modelSettings.subscriptionNotice')),
    ).toBeNull();
    const card = screen.getByTestId('provider-option-0');
    expect(card).toBeDisabled();
    await fireEvent.press(card);
    expect(screen.queryByTestId('provider-selection-confirm')).toBeNull();
  }
  await fireEvent.press(screen.getByTestId('model-tab-voice'));
  expect(
    screen.getByTestId('voice-model-apple-system-speech'),
  ).toHaveTextContent(new RegExp(t('modelSettings.appleVoice')));
  expect(screen.getByText('Private Cloud Compute에서 처리')).toBeTruthy();
  expect(screen.getByText('사용 승인을 받지 못했어요.')).toBeTruthy();
  expect(screen.getByTestId('provider-option-0')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  expect(screen.queryByText(t('modelSettings.subscriptionNotice'))).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(calendarModelStore.save).not.toHaveBeenCalled();
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
});

it.each(['unsupportedOS', 'quotaExceeded', 'unavailable'] as const)(
  'preserves distinct %s failures',
  async status => {
    jest
      .spyOn(applePrivateCloudComputeProvider, 'getAvailability')
      .mockResolvedValue({ status });
    const option = await loadPrivateCloudComputeOption();
    expect(option.availability).toEqual({
      status: 'unavailable',
      message: t(
        (
          {
            unsupportedOS: 'provider.pcc.unsupportedOS',
            quotaExceeded: 'provider.pcc.quotaExceeded',
            unavailable: 'provider.pcc.unavailable',
          } as const
        )[status],
      ),
    });
    expect(option.modelId).toBe(APPLE_PCC_MODEL_ID);
    expect(option.privacyBoundary).toBe('selected-context-remote');
  },
);

it('does not block an approved cloud option and retains explicit remote consent', async () => {
  jest
    .spyOn(applePrivateCloudComputeProvider, 'getAvailability')
    .mockResolvedValue({ status: 'available' });
  const option = await loadPrivateCloudComputeOption();
  const save = jest.fn();
  await render(
    <ProviderSelectionScreen
      options={[option]}
      requirements={{ inputTypes: ['text'] }}
      selectionStore={{ load: async () => null, save, clear: jest.fn() }}
    />,
  );
  expect(screen.getByTestId('provider-option-0')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  expect(
    screen.getByTestId('provider-selection-confirmation-privacy'),
  ).toHaveTextContent(t('provider.pcc.privacy'));
  expect(save).not.toHaveBeenCalled();
});
