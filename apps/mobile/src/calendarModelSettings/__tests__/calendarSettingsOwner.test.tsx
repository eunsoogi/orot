import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CalendarModelSettingsPanel } from '../CalendarModelSettingsPanel';
import { createAppleSelectionOption } from '../../providers/selection/options';
import type { ProviderSelection } from '../../providers/selection/types';
import {
  ModelSettingsServicesContext,
  type ModelSettingsServices,
} from '../../agent/execution/ModelSettingsServices';
import { modelSettingsVoiceFixture } from '../../agent/execution/testSupport/modelSettingsServiceFixture';

// UI lifetime test: only the owner stores/catalog are synthetic, with no native account fallback.
test('replacement calendar and voice owners discard the old draft and same-revision catalog', async () => {
  const apple = createAppleSelectionOption('available');
  const first: ModelSettingsServices = {
    calendar: {
      load: async () => ({
        providerId: 'old-owner',
        modelId: 'old-saved-model',
      }),
      save: async () => {},
      clear: async () => {},
    },
    voice: {
      ...modelSettingsVoiceFixture(),
      accountStatus: async () => ({ connected: true, revision: 1 }),
      discoverModels: async () => ({ revision: 1, ids: ['gpt-6-luna'] }),
    },
    calendarOption: modelId => ({
      ...apple,
      modelId,
      displayName: 'Old owner catalog',
      provider: { ...apple.provider, id: 'openai-api-decisions' },
    }),
    saveConsent: jest.fn(async () => {}),
  };
  const onBusyChange = jest.fn();
  const content = (services: ModelSettingsServices) => (
    <ModelSettingsServicesContext.Provider value={services}>
      <CalendarModelSettingsPanel options={[]} onBusyChange={onBusyChange} />
    </ModelSettingsServicesContext.Provider>
  );
  const view = await render(content(first));
  await waitFor(() =>
    expect(view.getByTestId('calendar-current-model')).toHaveTextContent(
      /old-saved-model/,
    ),
  );
  await waitFor(() =>
    expect(view.getByTestId('calendar-model-refresh')).not.toBeDisabled(),
  );
  await fireEvent.press(view.getByTestId('calendar-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('provider-option-0')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('provider-option-0'));
  expect(view.getByTestId('provider-selection-confirmation')).toBeTruthy();
  let finish!: (value: ProviderSelection | null) => void;
  const next: ModelSettingsServices = {
    ...first,
    calendar: {
      ...first.calendar,
      load: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    },
    voice: { ...first.voice },
  };
  await view.rerender(content(next));
  expect(view.queryByTestId('provider-selection-confirmation')).toBeNull();
  expect(view.queryByText('Old owner catalog')).toBeNull();
  expect(view.queryByText('old-saved-model')).toBeNull();
  expect(view.queryByTestId('provider-option-0')).toBeNull();
  await act(async () => {
    finish({ providerId: 'new-owner', modelId: 'new-saved-model' });
  });
  await waitFor(() =>
    expect(view.getByTestId('calendar-current-model')).toHaveTextContent(
      /new-saved-model/,
    ),
  );
  expect(first.saveConsent).not.toHaveBeenCalled();
  await view.unmount();
});
