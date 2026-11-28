import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { RecordsRouteEntries } from '../RecordsRouteEntries';

jest.mock('../../layout/AppSymbol', () => ({
  AppSymbol: ({ name }: { name: string }) => {
    const { View } = jest.requireActual('react-native');
    return <View testID={name} />;
  },
}));

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
// The default launcher test describes standard type, not the Jest preset's large font scale.
beforeEach(() =>
  Dimensions.set({
    window: { ...originalDimensions.window, fontScale: 1 },
    screen: { ...originalDimensions.screen, fontScale: 1 },
  }),
);
afterEach(() => Dimensions.set(originalDimensions));

function actions() {
  return {
    onOpenSchedule: jest.fn(),
    onOpenSavedRecordings: jest.fn(),
    onOpenHealthLibrary: jest.fn(),
    onOpenManualHistory: jest.fn(),
    onOpenGeneratedReports: jest.fn(),
    onImportMedicalDocument: jest.fn(),
    onImportMedicalPhoto: jest.fn(),
    medicalDocumentOpening: false,
    medicalDocumentDisabled: false,
  };
}

const rows = [
  ['일정', '저장된 녹음', '가져온 건강 기록'],
  ['기억', '대화에서 생성한 자료'],
];
const iconNames = [
  'calendar',
  'waveform',
  'folder.badge.plus',
  'bookmark',
  'doc.on.doc',
];

test('displays the five existing destinations as three aligned columns in a single launcher', async () => {
  const handlers = actions();
  await render(<RecordsRouteEntries {...handlers} />);

  const launcher = within(screen.getByTestId('records-material-directory'));
  const visibleRows = launcher.getAllByTestId('records-material-launcher-row');
  expect(
    visibleRows.map(row =>
      within(row)
        .getAllByRole('button')
        .map(button => button.props.accessibilityLabel),
    ),
  ).toEqual(rows);

  const icons = launcher.getAllByTestId('records-material-launcher-icon');
  const backgroundColors = icons.map(icon => {
    const style = StyleSheet.flatten(icon.props.style);
    expect(style.width).toBe(style.height);
    expect(style.width).toBeGreaterThanOrEqual(44);
    return style.backgroundColor;
  });
  expect(new Set(backgroundColors).size).toBe(5);
  for (const [index, name] of iconNames.entries()) {
    expect(within(icons[index]!).getByTestId(name)).toBeTruthy();
  }

  const routeHandlers = [
    handlers.onOpenSchedule,
    handlers.onOpenSavedRecordings,
    handlers.onOpenHealthLibrary,
    handlers.onOpenManualHistory,
    handlers.onOpenGeneratedReports,
  ];
  for (const [index, name] of rows.flat().entries()) {
    await fireEvent.press(launcher.getByRole('button', { name }));
    expect(routeHandlers[index]).toHaveBeenCalledTimes(1);
  }

  expect(launcher.queryByTestId('records-import-medical-document')).toBeNull();
  const imports = within(screen.getByTestId('records-document-import'));
  await fireEvent.press(imports.getByTestId('records-import-medical-document'));
  await fireEvent.press(imports.getByTestId('records-import-medical-photo'));
  expect(handlers.onImportMedicalDocument).toHaveBeenCalledTimes(1);
  expect(handlers.onImportMedicalPhoto).toHaveBeenCalledTimes(1);
});

test('keeps existing inactive-destination guards and labels', async () => {
  const handlers = actions();
  await render(
    <RecordsRouteEntries
      {...handlers}
      materialsActive={false}
      medicalDocumentDisabled
    />,
  );

  const launcher = within(screen.getByTestId('records-material-directory'));
  const memory = launcher.getByRole('button', { name: '기억' });
  const generated = launcher.getByRole('button', {
    name: '대화에서 생성한 자료',
  });
  const schedule = launcher.getByRole('button', { name: '일정' });
  expect(memory.props.accessibilityHint).toBe(
    '과거 건강 기록과 대화에서 저장한 기억을 확인해요.',
  );
  for (const unavailable of [memory, generated, schedule]) {
    expect(unavailable).toBeDisabled();
    await fireEvent.press(unavailable);
  }
  expect(handlers.onOpenManualHistory).not.toHaveBeenCalled();
  expect(handlers.onOpenGeneratedReports).not.toHaveBeenCalled();
  expect(handlers.onOpenSchedule).not.toHaveBeenCalled();
  expect(launcher.getByRole('button', { name: '저장된 녹음' })).toBeEnabled();
});
