import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { CalendarModelSettingsPanel } from '../CalendarModelSettingsPanel';
import { calendarModelStore } from '../calendarModelStore';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { resolveCalendarModel } from '../resolveCalendarModel';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';

// View-only boundary: SQLite grant activation and credential races have dedicated service tests.
jest.mock('../../agent/execution/saveModelSettingsConsent', () => ({
  saveModelSettingsConsent: async (input: {
    store: { save(value: unknown): Promise<void> };
    selection: unknown;
  }) => input.store.save(input.selection),
}));
jest.mock(
  '../../layout/AppButton',
  () => require('../testSupport/calendarButtonFixture').calendarButtonFixture,
);

jest.mock('../calendarModelStore', () => ({
  calendarModelStore: {
    ...jest
      .requireActual(
        '../../agent/execution/testSupport/modelSettingsServiceFixture',
      )
      .modelSettingsSelectionFixture(),
    load: jest.fn(),
    save: jest.fn(),
  },
}));
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    ...jest
      .requireActual(
        '../../agent/execution/testSupport/modelSettingsServiceFixture',
      )
      .modelSettingsVoiceFixture(),
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
  expect(
    screen.getByText('이 모델을 사용하면 별도 OpenAI API 사용료가 청구돼요.'),
  ).toBeTruthy();
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

it('uses the shared compact API account card and keeps disconnected management reachable', async () => {
  account.accountStatus.mockResolvedValue({ connected: false, revision: 3 });
  const onOpenAccounts = jest.fn();
  await render(
    <CalendarModelSettingsPanel
      options={[]}
      onBusyChange={jest.fn()}
      chatGPTSetup={{
        presentation: 'settings-provider',
        accounts: [],
        selectedAccountID: null,
        statusMessage: '',
        statusIsError: false,
        actionTitle: '',
        busy: false,
        signingIn: false,
        signingOut: false,
        actionDisabled: false,
        onAccountSelected: jest.fn(),
        onAction: jest.fn(),
        onSignOut: jest.fn(),
        onCancelSignIn: jest.fn(),
        onOpenAccounts,
      }}
    />,
  );
  expect(screen.getByTestId('calendar-model-refresh')).toBeDisabled();
  expect(screen.queryByTestId('calendar-open-accounts')).toBeNull();
  expect(
    screen.queryByText('연결된 계정에서 OpenAI API 키를 등록해 주세요.'),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('calendar-account-details'));
  await fireEvent.press(screen.getByTestId('calendar-open-accounts'));
  expect(onOpenAccounts).toHaveBeenCalledTimes(1);
  expect(account.discoverModels).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});

it('keeps the compact refresh disabled until its explicit discovery finishes', async () => {
  let complete!: (value: { revision: number; ids: string[] }) => void;
  account.discoverModels.mockImplementation(
    () =>
      new Promise(resolve => {
        complete = resolve;
      }),
  );
  await render(
    <CalendarModelSettingsPanel options={[]} onBusyChange={jest.fn()} />,
  );
  await fireEvent.press(screen.getByTestId('calendar-model-refresh'));
  expect(screen.getByTestId('calendar-model-refresh')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('calendar-model-refresh'));
  expect(account.discoverModels).toHaveBeenCalledTimes(1);
  await act(async () => complete({ revision: 3, ids: ['gpt-6-luna'] }));
  expect(screen.getByTestId('calendar-model-refresh')).not.toBeDisabled();
  expect(screen.getByText('Synthetic Decisions')).toBeTruthy();
});

it('groups unset and saved identity in the shared summary without the removed introduction', async () => {
  await render(
    <CalendarModelSettingsPanel options={[apple]} onBusyChange={jest.fn()} />,
  );
  expect(screen.getByTestId('calendar-current-model-card')).toHaveStyle({
    padding: 16,
    borderRadius: 20,
    borderWidth: 0,
  });
  expect(screen.getByTestId('calendar-current-model')).toHaveTextContent(
    '일정 분류 모델을 선택해 주세요.',
  );
  expect(
    screen.queryByText(
      '캘린더 일정의 진료 관련성을 분류할 모델이에요. 대화 모델은 바뀌지 않아요.',
    ),
  ).toBeNull();
  expect(
    screen.queryByText(
      'OpenAI API의 Decisions 모델만 표시해요. API 사용료는 별도로 청구돼요.',
    ),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  expect(screen.queryByTestId('calendar-current-model-card')).toBeNull();
  expect(store.save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  expect(screen.getByTestId('calendar-current-model-card')).toBeTruthy();
  expect(screen.getByTestId('calendar-current-model')).toHaveTextContent(
    /현재 선택:/,
  );
  expect(screen.getByTestId('calendar-current-model')).toHaveTextContent(
    new RegExp(apple.modelId),
  );
});
