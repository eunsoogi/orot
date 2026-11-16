import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { CalendarModelSettingsPanel } from '../CalendarModelSettingsPanel';
import { calendarModelStore } from '../calendarModelStore';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { resolveCalendarModel } from '../resolveCalendarModel';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';

jest.mock('../../layout/AppButton', () => ({
  AppButton: ({
    onPress,
    title,
    ...props
  }: {
    onPress?: () => unknown;
    title: string;
    testID?: string;
    disabled?: boolean;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable
        {...props}
        onPress={() => {
          onPress?.();
        }}
      >
        <Text>{title}</Text>
      </Pressable>
    );
  },
}));

jest.mock('../calendarModelStore', () => ({
  calendarModelStore: { load: jest.fn(), save: jest.fn() },
}));
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    subscribe: jest.fn(() => () => {}),
    accountStatus: jest.fn(),
    discoverModels: jest.fn(),
  },
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../decisionsProvider', () => ({
  createCalendarDecisionsOption: (modelId: string) => ({
    modelId,
    displayName: 'Synthetic Decisions',
    privacyBoundary: 'selected-context-remote',
    availability: { status: 'available' },
    provider: {
      id: 'openai-api-decisions',
      kind: 'language-model',
      displayName: 'Synthetic',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: true,
        toolCalling: false,
      },
      generate: jest.fn(),
    },
  }),
}));
const apple = createAppleSelectionOption('available');
const store = jest.mocked(calendarModelStore);
const account = jest.mocked(voiceSettingsStore);
beforeEach(() => {
  jest.clearAllMocks();
  store.load.mockResolvedValue(null);
  store.save.mockResolvedValue();
  account.accountStatus.mockResolvedValue({ connected: true, revision: 3 });
});
it('starts unselected without inheriting or resolving the conversation choice', async () => {
  await expect(resolveCalendarModel()).resolves.toEqual({
    status: 'selection-required',
  });
  expect(resolveSelectedAiProvider).not.toHaveBeenCalled();
  expect(account.accountStatus).not.toHaveBeenCalled();
});
it('resolves Apple or ChatGPT against only the independent saved selection', async () => {
  store.load.mockResolvedValue({
    providerId: apple.provider.id,
    modelId: apple.modelId,
  });
  jest
    .mocked(resolveSelectedAiProvider)
    .mockResolvedValue({ status: 'unavailable' });
  await expect(resolveCalendarModel()).resolves.toEqual({
    status: 'unavailable',
  });
  expect(store.load).toHaveBeenCalledTimes(1);
  const snapshot = jest.mocked(resolveSelectedAiProvider).mock.calls[0][0]
    ?.selectionStore;
  await expect(snapshot?.load()).resolves.toEqual({
    providerId: apple.provider.id,
    modelId: apple.modelId,
  });
  expect(store.load).toHaveBeenCalledTimes(1);
});
it('requires confirmation and writes only the calendar selection', async () => {
  await render(
    <CalendarModelSettingsPanel options={[apple]} onBusyChange={jest.fn()} />,
  );
  expect(account.discoverModels).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  expect(store.save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  expect(store.save).toHaveBeenCalledWith({
    providerId: apple.provider.id,
    modelId: apple.modelId,
  });
});
it('offers only the documented Decisions model returned by explicit account discovery', async () => {
  account.discoverModels.mockResolvedValue({
    revision: 3,
    ids: ['gpt-6-luna', 'gpt-6', 'fake-decision-model'],
  });
  await render(
    <CalendarModelSettingsPanel options={[]} onBusyChange={jest.fn()} />,
  );
  expect(account.discoverModels).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('calendar-model-refresh'));
  expect(screen.getByText('Synthetic Decisions')).toBeTruthy();
  expect(screen.queryByText('fake-decision-model')).toBeNull();
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  account.accountStatus.mockResolvedValue({ connected: true, revision: 4 });
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  expect(store.save).not.toHaveBeenCalled();
});
it('does not publish a late catalog after account replacement', async () => {
  let finish!: (result: { revision: number; ids: string[] }) => void;
  account.discoverModels.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await render(
    <CalendarModelSettingsPanel options={[]} onBusyChange={jest.fn()} />,
  );
  await fireEvent.press(screen.getByTestId('calendar-model-refresh'));
  await act(() => {
    account.subscribe.mock.calls.at(-1)![0]();
  });
  await act(async () => {
    finish({ revision: 3, ids: ['gpt-6-luna'] });
  });
  expect(screen.queryByText('Synthetic Decisions')).toBeNull();
});
