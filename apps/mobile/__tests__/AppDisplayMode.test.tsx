import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import {
  Appearance,
  DeviceEventEmitter,
  Settings,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import App from '../App';
import { createAppointmentStore } from '../test-helpers/appointmentStore';
import { appColorPalettes } from '../src/layout/appColors';
import { AppText } from '../src/layout/AppText';

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

jest.mock('react-native/Libraries/Settings/NativeSettingsManager', () => ({
  getConstants: () => ({ settings: {} }),
  setValues: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/useColorScheme', () =>
  jest.requireActual('react-native/Libraries/Utilities/useColorScheme'),
);

jest.mock('react-native/Libraries/Utilities/NativeAppearance', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    getColorScheme: () => mockEffectiveScheme(),
    setColorScheme: (style: 'auto' | 'light' | 'dark') => {
      mockAppearance = style;
      mockNotifyAppearance();
    },
  },
}));

const key = 'orot.app.display-mode.v1';
let stored: unknown;
let system: 'light' | 'dark';
let mockAppearance: 'light' | 'dark' | 'auto';

function mockEffectiveScheme() {
  return mockAppearance === 'auto' ? system : mockAppearance;
}

function mockNotifyAppearance() {
  DeviceEventEmitter.emit('appearanceChanged', {
    colorScheme: mockEffectiveScheme(),
  });
}

function ThemeObserver() {
  return (
    <AppText testID="current-app-color-scheme">{useColorScheme()}</AppText>
  );
}

beforeEach(() => {
  stored = undefined;
  system = 'light';
  mockAppearance = 'auto';
  mockNotifyAppearance();
  jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  jest
    .spyOn(Settings, 'get')
    .mockImplementation(name => (name === key ? stored : undefined));
  jest.spyOn(Settings, 'set').mockImplementation(values => {
    stored = key in values ? values[key] : undefined;
  });
  jest.spyOn(Appearance, 'setColorScheme');
});

afterEach(() => jest.restoreAllMocks());

async function openDisplayMode() {
  const appointments = createAppointmentStore();
  const mounted = await render(
    <>
      <ThemeObserver />
      <App
        loadAppointments={async () => appointments.repository}
        loadRecordings={async () => []}
      />
    </>,
  );
  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await fireEvent.press(screen.getByRole('button', { name: '화면 모드' }));
  expect(screen.getByRole('header', { name: '화면 모드' })).toBeVisible();
  return mounted;
}

it('persists rapid exclusive selections, reopens its route and returns to live system appearance', async () => {
  const first = await openDisplayMode();
  const options = () => screen.getByTestId('display-mode-options');
  const radio = (label: string) =>
    within(options()).getByRole('radio', { name: label });
  const checked = (label: string) =>
    expect(within(options()).getAllByRole('radio', { checked: true })).toEqual([
      radio(label),
    ]);
  const scheme = (color: string) =>
    expect(screen.getByTestId('current-app-color-scheme')).toHaveTextContent(
      color,
    );
  checked('시스템');
  expect(Settings.set).not.toHaveBeenCalled();
  expect(Appearance.setColorScheme).not.toHaveBeenCalled();
  await act(() => {
    system = 'dark';
    mockNotifyAppearance();
  });
  scheme('dark');
  for (const [label, value] of [
    ['라이트 모드', 'light'],
    ['다크 모드', 'dark'],
    ['라이트 모드', 'light'],
  ]) {
    await fireEvent.press(radio(label));
    checked(label);
    scheme(value);
  }
  expect(jest.mocked(Appearance.setColorScheme).mock.calls).toEqual([
    ['light'],
    ['dark'],
    ['light'],
  ]);
  await act(() => {
    system = 'light';
    mockNotifyAppearance();
    system = 'dark';
    mockNotifyAppearance();
  });
  scheme('light');
  expect(stored).toBe('light');
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByRole('button', { name: '화면 모드' })).toBeVisible();
  await first.unmount();

  await openDisplayMode();
  checked('라이트 모드');
  await fireEvent.press(radio('시스템'));
  checked('시스템');
  expect(Settings.set).toHaveBeenLastCalledWith({ [key]: 'system' });
  expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('auto');
  scheme('dark');
  await act(() => {
    system = 'light';
    mockNotifyAppearance();
  });
  scheme('light');
});

it('uses the default for unknown storage and keeps opposite previews legible at compact and expanded widths', async () => {
  stored = { mode: 'legacy' };
  await openDisplayMode();
  const options = screen.getByTestId('display-mode-options');
  expect(
    within(options).getByRole('radio', { name: '시스템', checked: true }),
  ).toBeVisible();
  expect(Settings.set).not.toHaveBeenCalled();
  for (const [width, direction] of [
    [280, 'row'],
    [540, 'row'],
    [216, 'column'],
  ] as const) {
    await fireEvent(options, 'layout', { nativeEvent: { layout: { width } } });
    expect(
      StyleSheet.flatten(screen.getByTestId('display-mode-options').props.style)
        .flexDirection,
    ).toBe(direction);
  }
  const systemPreview = within(screen.getByRole('radio', { name: '시스템' }));
  for (const appearanceName of ['light', 'dark'] as const) {
    const preview = systemPreview.getByTestId(
      `display-preview-${appearanceName}`,
      { includeHiddenElements: true },
    );
    expect(StyleSheet.flatten(preview.props.style).backgroundColor).toBe(
      appColorPalettes[appearanceName].background,
    );
  }
});
