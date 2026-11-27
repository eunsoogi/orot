import { act, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { AppText } from '../../layout/AppText';
import { AssistantAppearanceProvider } from '../AssistantAppearanceProvider';
import { appearanceStore } from '../appearanceStore';
import type { AssistantAppearance } from '../appearance';

jest.unmock('../../appEntry/useStartupMinimumDisplay');

jest.mock('../appearanceStore', () => ({
  appearanceStore: { load: jest.fn(), save: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaProvider: View,
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 52, right: 8, bottom: 34, left: 8 }),
  };
});

const previousWindow = Dimensions.get('window');
const previousScreen = Dimensions.get('screen');

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  Dimensions.set({ window: previousWindow, screen: previousScreen });
  jest.clearAllMocks();
});

test.each([
  ['compact portrait', 320, 640, 92, 'column'],
  ['short landscape', 720, 350, 70, 'row'],
  ['expanded portrait', 820, 1120, 112, 'column'],
] as const)(
  'keeps %s edge-to-edge while the real startup gate is pending',
  async (_name, width, height, size, direction) => {
    const frame = { ...previousWindow, width, height, fontScale: 2 };
    Dimensions.set({ window: frame, screen: frame });
    let resolve!: (value: AssistantAppearance) => void;
    jest.mocked(appearanceStore.load).mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );
    await render(
      <AssistantAppearanceProvider>
        <AppText>준비 완료</AppText>
      </AssistantAppearanceProvider>,
    );
    expect(screen.queryByText('준비 완료')).toBeNull();
    expect(screen.getByRole('header', { name: '오롯' })).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: '설정을 불러오는 중' }).props
        .accessibilityState,
    ).toEqual({ busy: true });
    const outer = screen.getByTestId('startup-surface');
    const ornament = screen.getByTestId('startup-decoration', {
      includeHiddenElements: true,
    });
    const readable = screen.getByTestId('startup-readable-area');
    expect(ornament.parent).toBe(outer);
    expect(readable.parent).toBe(outer);
    expect(StyleSheet.flatten(outer.props.style)).toEqual(
      expect.objectContaining({ flex: 1, backgroundColor: expect.anything() }),
    );
    expect(StyleSheet.flatten(ornament.props.style)).toEqual(
      expect.objectContaining({
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }),
    );
    expect(ornament.props).toMatchObject({
      pointerEvents: 'none',
      accessibilityElementsHidden: true,
    });
    expect(readable.props.edges).toEqual(['top', 'right', 'bottom', 'left']);
    expect(
      StyleSheet.flatten(screen.getByTestId('startup-lockup').props.style)
        .flexDirection,
    ).toBe(direction);
    expect(
      StyleSheet.flatten(
        screen.getByTestId('startup-mark', { includeHiddenElements: true })
          .props.style,
      ),
    ).toEqual(expect.objectContaining({ width: size, height: size }));
    expect(appearanceStore.load).toHaveBeenCalledTimes(1);
    expect(appearanceStore.save).not.toHaveBeenCalled();

    await act(async () => resolve({ avatar: 'neutral', name: null }));
    expect(screen.queryByText('준비 완료')).toBeNull();
    expect(screen.getByTestId('startup-surface')).toBeVisible();
    await act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(screen.getByText('준비 완료')).toBeTruthy();
    expect(screen.queryByTestId('startup-surface')).toBeNull();
    expect(appearanceStore.load).toHaveBeenCalledTimes(1);
  },
);
