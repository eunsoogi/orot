import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
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
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      save: async () => {},
      clear: async () => {},
    },
    voice: {
      ...modelSettingsVoiceFixture(),
      accountStatus: async () => ({ connected: true, revision: 1 }),
      accountRevisionMatches: revision => revision === 1,
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
      <CalendarModelSettingsPanel
        options={[apple]}
        onBusyChange={onBusyChange}
      />
    </ModelSettingsServicesContext.Provider>
  );
  const view = await render(content(first));
  await waitFor(() =>
    expect(
      view.getByTestId('provider-option-0').props.accessibilityState.selected,
    ).toBe(true),
  );
  await waitFor(() =>
    expect(view.getByTestId('calendar-model-refresh')).not.toBeDisabled(),
  );
  await fireEvent.press(view.getByTestId('calendar-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('provider-option-1')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('provider-option-1'));
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
  expect(view.queryByTestId('provider-option-1')).toBeNull();
  await act(async () => {
    finish({ providerId: 'new-owner', modelId: 'new-saved-model' });
  });
  await waitFor(() =>
    expect(
      view.getByTestId('provider-option-0').props.accessibilityState.selected,
    ).toBe(false),
  );
  expect(first.saveConsent).not.toHaveBeenCalled();
  await view.unmount();
});

test('keeps the Decisions label before, during and after explicit catalog discovery', async () => {
  let finish!: (value: { revision: number; ids: string[] }) => void;
  const discoverModels = jest.fn(
    () =>
      new Promise<{ revision: number; ids: string[] }>(resolve => {
        finish = resolve;
      }),
  );
  const apple = createAppleSelectionOption('available');
  const saved = { providerId: 'openai-api-decisions', modelId: 'gpt-6-luna' };
  const services: ModelSettingsServices = {
    calendar: {
      load: async () => saved,
      save: jest.fn(async () => {}),
      clear: async () => {},
    },
    voice: {
      ...modelSettingsVoiceFixture(),
      accountStatus: async () => ({ connected: true, revision: 3 }),
      accountRevisionMatches: revision => revision === 3,
      discoverModels,
    },
    calendarOption: modelId => ({
      ...apple,
      modelId,
      displayName: 'Synthetic Decisions',
      provider: { ...apple.provider, id: saved.providerId },
    }),
    saveConsent: jest.fn(async () => {}),
  };
  await render(
    <ModelSettingsServicesContext.Provider value={services}>
      <CalendarModelSettingsPanel options={[]} onBusyChange={jest.fn()} />
    </ModelSettingsServicesContext.Provider>,
  );
  expect(screen.queryByTestId('calendar-current-model-card')).toBeNull();
  expect(screen.getByRole('header', { name: 'OpenAI API' })).toBeTruthy();
  expect(discoverModels).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('calendar-model-refresh'));
  await act(async () => finish({ revision: 3, ids: ['gpt-6-luna'] }));
  expect(screen.getByTestId('provider-option-0')).toHaveTextContent(
    /GPT-6 Luna/,
  );
  expect(
    screen.getByTestId('provider-option-0').props.accessibilityState.selected,
  ).toBe(true);
  expect(screen.queryByText('gpt-6-luna')).toBeNull();
  expect(services.saveConsent).not.toHaveBeenCalled();
});
