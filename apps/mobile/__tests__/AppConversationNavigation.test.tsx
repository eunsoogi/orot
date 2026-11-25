import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Dimensions } from 'react-native';
import App from '../App';
import { openGeometry } from '../src/navigation/__fixtures__/navigationOpenGeometry';
import * as replyFocusModule from '../src/replyNotifications/replyFocus';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('the actual App passes live route and overlay visibility to reply focus', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const hook = jest.spyOn(replyFocusModule, 'useReplyFocusForSession');
  await render(<App />);
  await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
  await waitFor(() => expect(hook).toHaveBeenCalled());
  const visible = hook.mock.calls.at(-1)?.[1];
  expect(visible?.()).toBe(true);
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('settings-provider-screen')).toBeTruthy();
  expect(visible?.()).toBe(false);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(visible?.()).toBe(true));
});

test('opens conversation immediately and returns from provider overlays without losing its draft', async () => {
  // Jest's native-stack does not emit UIKit transitionEnd; XCUITest covers animated completion.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  await render(<App />);

  await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.queryByTestId('ai-features-screen')).toBeNull();
  expect(screen.queryByTestId('ai-feature-health-review')).toBeNull();
  expect(screen.queryByTestId('external-evidence-search')).toBeNull();
  expect(
    screen.queryByText(
      '필요하면 동의를 받고 공개 웹자료와 의학 문헌도 찾아요.',
    ),
  ).toBeNull();
  expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '계속할 대화 초안',
  );
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('settings-provider-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
    '계속할 대화 초안',
  );
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('settings-provider-screen')).toBeTruthy();
  expect(screen.queryByTestId('rag-conversation-sessions-toggle')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
      '계속할 대화 초안',
    ),
  );
  expect(screen.queryByTestId('rag-conversation-new-session')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
    '계속할 대화 초안',
  );
}, 30_000);

test('keeps recording under Records when leaving an conversation route', async () => {
  // This host-level flow checks the route result; XCUITest covers UIKit animation completion.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  await render(<App />);

  await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
  expect(await screen.findByTestId('rag-conversation-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('settings-provider-screen')).toBeTruthy();

  expect(screen.queryByTestId('navigation-recording')).toBeNull();
  expect(screen.queryByTestId('navigation-home')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await fireEvent.press(screen.getByTestId('records-new-recording'));

  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByTestId('ai-feature-flow')).toBeNull(),
  );
});

test('lifts Conversation visuals using the top indicator', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const window = Dimensions.get('window');
  const sameWindow = openGeometry.windowBounds;
  Dimensions.set({ window: { ...window, ...sameWindow, fontScale: 1.6 } });
  const app = await render(<App />);
  try {
    await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
    const sensor = screen.getByTestId('navigation-window-geometry-sensor');
    const geometry = {
      ...openGeometry,
      safeAreaInsets: { ...openGeometry.safeAreaInsets, top: 56 },
      navigationSide: 'right' as const,
    };
    const update = (systemTopBarFrame?: typeof sameWindow) =>
      fireEvent(sensor, 'geometryChange', {
        nativeEvent: { ...geometry, systemTopBarFrame },
      });
    await update();
    const rail = await screen.findByTestId('navigation-right-rail-host');
    expect(rail).toBeTruthy();

    const identity = await screen.findByTestId('assistant-floating-identity');
    const artwork = screen.getByTestId('assistant-profile-artwork');
    const label = screen.getByTestId('assistant-profile-label');
    const input = screen.getByTestId('rag-conversation-input');
    const history = screen.getByTestId('rag-conversation-history');
    const touchStyle = identity.props.style;
    const ordinaryArtwork = artwork.props.style;
    const ordinaryLabel = label.props.style;
    await fireEvent.changeText(input, '계속할 대화 초안');

    await update({ ...sameWindow, height: 40 });
    expect(artwork).toHaveStyle({ transform: [{ translateY: -12 }] });
    expect(label).toHaveStyle({ transform: [{ translateY: -12 }] });
    expect(screen.queryByTestId('navigation-right-rail-host')).toBeNull();
    expect(screen.getByTestId('navigation-tab-conversation')).toBeTruthy();
    expect(screen.getByTestId('assistant-floating-identity')).toBe(identity);
    expect(identity.props.style).toEqual(touchStyle);
    expect(identity).toBeEnabled();
    expect(label).toHaveProp('pointerEvents', 'none');
    expect(screen.getByTestId('rag-conversation-history')).toBe(history);
    expect(screen.getByTestId('rag-conversation-input')).toBe(input);
    expect(input).toHaveDisplayValue('계속할 대화 초안');

    await update({ ...sameWindow, height: 55 });
    expect(artwork.props.style).toEqual(ordinaryArtwork);
    expect(label.props.style).toEqual(ordinaryLabel);
    await update({ x: 905, y: 0, width: 46, height: 150 });
    expect(screen.getByTestId('navigation-right-rail-host')).toBeTruthy();
    expect(artwork.props.style).toEqual(ordinaryArtwork);
    expect(label.props.style).toEqual(ordinaryLabel);
    await fireEvent.press(identity);
    const editor = await screen.findByTestId('assistant-appearance-scroll');
    expect(editor).toBeTruthy();
  } finally {
    await app.unmount();
    Dimensions.set({ window });
  }
});
