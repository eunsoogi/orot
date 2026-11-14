import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useEffect } from 'react';
import { NativeModules } from 'react-native';
import { AppText } from '../../layout/AppText';
import {
  AssistantAppearanceProvider,
  useAssistantAppearance,
} from '../AssistantAppearanceProvider';
import { appearanceStore } from '../appearanceStore';
import { AppButton } from '../../layout/AppButton';

jest.mock('../appearanceStore', () => ({
  appearanceStore: { load: jest.fn(), save: jest.fn(), clear: jest.fn() },
}));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock(
  '../../layout/SafeAreaLayout',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      children,
);
const store = jest.mocked(appearanceStore);
const nativeModules = NativeModules as unknown as Record<string, unknown>;
const previousSettingsManager = nativeModules.SettingsManager;

function Content() {
  const appearance = useAssistantAppearance();
  return (
    <>
      <AppText>일반 화면</AppText>
      <AppText>{appearance?.value.name ?? '비서'}</AppText>
      <AppButton title="편집" onPress={() => appearance?.edit()} />
    </>
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  nativeModules.SettingsManager = { settings: {} };
});

afterAll(() => {
  if (previousSettingsManager === undefined) {
    delete nativeModules.SettingsManager;
  } else {
    nativeModules.SettingsManager = previousSettingsManager;
  }
});

test('requires explicit selection and keeps failed save at setup before opening content', async () => {
  store.load.mockResolvedValue(null);
  store.save
    .mockRejectedValueOnce(new Error('write'))
    .mockResolvedValueOnce({ avatar: 'neutral', name: null });
  await render(
    <AssistantAppearanceProvider>
      <Content />
    </AssistantAppearanceProvider>,
  );
  await screen.findByText('함께할 비서를 골라주세요');
  expect(screen.queryByText('일반 화면')).toBeNull();
  expect(
    screen.getByRole('button', { name: '설정하고 시작하기' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByRole('radio', { name: '기본' }));
  await fireEvent.press(
    screen.getByRole('button', { name: '설정하고 시작하기' }),
  );
  await screen.findByText('저장하지 못했어요. 다시 시도해 주세요.');
  expect(screen.queryByText('일반 화면')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: '설정하고 시작하기' }),
  );
  await screen.findByText('일반 화면');
  expect(store.save).toHaveBeenCalledTimes(2);
});

test('read errors retry without writing and edit cancellation preserves the saved name', async () => {
  store.load
    .mockRejectedValueOnce(new Error('read'))
    .mockResolvedValueOnce({ avatar: 'leaf', name: '오롯' });
  await render(
    <AssistantAppearanceProvider>
      <Content />
    </AssistantAppearanceProvider>,
  );
  await screen.findByText('비서 설정을 불러오지 못했어요.');
  expect(store.save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  await screen.findByText('일반 화면');
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  await fireEvent.changeText(
    screen.getByPlaceholderText('어떤 이름으로 부를까요?'),
    '바꾼 이름',
  );
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  await waitFor(() => expect(screen.getByText('오롯')).toBeTruthy());
  expect(store.save).not.toHaveBeenCalled();
});

test('ignores synthetic flags in the production gate', async () => {
  nativeModules.SettingsManager = {
    settings: {
      OROT_TEST_PROFILE: 'core',
      OROT_E2E_PROBE: 'medical-document-import',
      OROT_TEST_ASSISTANT_APPEARANCE: 'synthetic',
    },
  };
  store.load.mockResolvedValue(null);
  await render(
    <AssistantAppearanceProvider>
      <Content />
    </AssistantAppearanceProvider>,
  );
  await screen.findByText('함께할 비서를 골라주세요');
  expect(screen.queryByText('일반 화면')).toBeNull();
  expect(store.save).not.toHaveBeenCalled();
});

test('keeps saved appearance while allowing replacement without a clear action', async () => {
  store.load.mockResolvedValue({ avatar: 'neutral', name: null });
  store.clear.mockResolvedValue();
  store.save.mockResolvedValue({ avatar: 'star', name: null });
  const unmounted = jest.fn();
  function RetainedContent() {
    useEffect(() => unmounted, []);
    return <Content />;
  }
  await render(
    <AssistantAppearanceProvider>
      <RetainedContent />
    </AssistantAppearanceProvider>,
  );
  await screen.findByText('일반 화면');
  expect(store.save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  expect(screen.queryByRole('button', { name: '선택 지우기' })).toBeNull();
  expect(store.clear).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('radio', { name: '별' }));
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() =>
    expect(store.save).toHaveBeenCalledWith({ avatar: 'star', name: null }),
  );
  expect(store.save).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});

test('cancel preserves the committed appearance and entry without deleting data', async () => {
  store.load.mockResolvedValue({ avatar: 'leaf', name: '오롯' });
  store.clear.mockRejectedValue(new Error('locked'));
  let canEnter = () => false;
  function EntryProbe() {
    const appearance = useAssistantAppearance();
    if (appearance) canEnter = appearance.canEnter;
    return <Content />;
  }
  await render(
    <AssistantAppearanceProvider>
      <EntryProbe />
    </AssistantAppearanceProvider>,
  );
  await screen.findByText('일반 화면');
  expect(canEnter()).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  expect(screen.queryByRole('button', { name: '선택 지우기' })).toBeNull();
  await fireEvent.press(screen.getByRole('radio', { name: '별' }));
  expect(store.clear).not.toHaveBeenCalled();
  expect(canEnter()).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  expect(screen.getByText('오롯')).toBeTruthy();
  expect(store.save).not.toHaveBeenCalled();
});
