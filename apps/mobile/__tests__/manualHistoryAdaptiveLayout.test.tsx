import { act, fireEvent, render } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import { manualHistorySupportsInlineDateControls } from '../src/manualHistory/ManualHistoryFormLayout';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  fontScale,
});

afterEach(async () => {
  await act(() =>
    Dimensions.set({ window: originalWindow, screen: originalScreen }),
  );
});

test('keeps date controls stacked until the measured form lane supports both controls', () => {
  expect(manualHistorySupportsInlineDateControls(759, 1)).toBe(false);
  expect(manualHistorySupportsInlineDateControls(760, 1)).toBe(true);
  expect(manualHistorySupportsInlineDateControls(1140, 1.5)).toBe(true);
  expect(manualHistorySupportsInlineDateControls(920, 1.5)).toBe(false);
  expect(manualHistorySupportsInlineDateControls(Number.NaN, 1)).toBe(false);
  expect(manualHistorySupportsInlineDateControls(920, 0)).toBe(false);
});

test('reflows the form inside the measured parent lane without losing an active draft', async () => {
  await act(() =>
    Dimensions.set({ window: viewport(960), screen: viewport(960) }),
  );
  const view = await render(
    <ManualHistoryScreen
      onBack={jest.fn()}
      repository={createManualHistoryTestRepository()}
    />,
  );
  await view.findByTestId('manual-history-empty');
  await fireEvent.press(view.getByTestId('manual-history-add'));

  const measureForm = async (width: number) =>
    fireEvent(view.getByTestId('manual-history-form'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width, height: 600 } },
    });
  const dateDirection = () =>
    StyleSheet.flatten(
      view.getByTestId('manual-history-date-controls').props.style,
    )?.flexDirection;

  await measureForm(960);
  expect(dateDirection()).toBe('row');
  await fireEvent.changeText(
    view.getByTestId('manual-history-title-input'),
    'Synthetic measured form title',
  );
  await fireEvent.changeText(
    view.getByTestId('manual-history-details-input'),
    'Synthetic details stay in the form while its measured lane narrows.',
  );

  await act(() =>
    Dimensions.set({
      window: viewport(960, 1.5),
      screen: viewport(960, 1.5),
    }),
  );
  expect(dateDirection()).toBeUndefined();
  await measureForm(560);
  expect(dateDirection()).toBeUndefined();
  await measureForm(960);
  expect(dateDirection()).toBeUndefined();
  expect(view.getByTestId('manual-history-title-input').props.value).toBe(
    'Synthetic measured form title',
  );
  expect(view.getByTestId('manual-history-details-input').props.value).toBe(
    'Synthetic details stay in the form while its measured lane narrows.',
  );

  await act(() =>
    Dimensions.set({ window: viewport(960), screen: viewport(960) }),
  );
  await measureForm(960);
  expect(dateDirection()).toBe('row');
  expect(view.getByTestId('manual-history-scroll')).toBeTruthy();
});

// A saved correction makes selection, lineage, provenance and local confirmation state observable together.
test('preserves selected correction history and confirmation state through measured reflow', async () => {
  await act(() =>
    Dimensions.set({ window: viewport(900), screen: viewport(900) }),
  );
  const repository = createManualHistoryTestRepository();
  const original = await repository.create({
    kind: 'diagnosis_history',
    title: 'Synthetic original history',
    details: 'Synthetic user supplied original details.',
    effectiveDate: { status: 'unknown' },
  });
  const corrected = await repository.correct(original.id, {
    kind: 'diagnosis_history',
    title: 'Synthetic corrected history',
    details: 'Synthetic user supplied corrected details.',
    effectiveDate: { status: 'unknown' },
    correctionNote: 'Synthetic correction note.',
  });
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );
  await view.findByTestId('manual-history-entry-' + corrected.id);

  const measureBrowser = async (width: number) => {
    await act(() =>
      Dimensions.set({ window: viewport(width), screen: viewport(width) }),
    );
  };
  const layoutDirection = () =>
    StyleSheet.flatten(view.getByTestId('manual-history-browser').props.style)
      ?.flexDirection;

  await measureBrowser(900);
  await fireEvent.press(
    view.getByTestId('manual-history-details-' + corrected.id),
  );
  await view.findByTestId('manual-history-correction-history');
  expect(layoutDirection()).toBe('column');
  expect(
    view.getByText('직접 입력한 기록이며 의료진이 확인한 정보가 아니에요.'),
  ).toBeTruthy();
  expect(view.getByTestId('manual-history-date-detail')).toHaveTextContent(
    '기준일을 모름',
  );
  expect(
    view.getByTestId('manual-history-version-' + original.id),
  ).toBeTruthy();
  expect(
    view.getByTestId('manual-history-version-' + corrected.id),
  ).toBeTruthy();
  expect(view.getByTestId('manual-history-correct')).toBeTruthy();
  expect(view.getByTestId('manual-history-delete')).toBeTruthy();
  expect(view.getByTestId('manual-history-close-details')).toBeTruthy();

  await fireEvent.press(view.getByTestId('manual-history-delete'));
  expect(view.getByTestId('manual-history-delete-confirmation')).toBeTruthy();

  await act(() =>
    Dimensions.set({ window: viewport(900, 1.5), screen: viewport(900, 1.5) }),
  );
  expect(layoutDirection()).toBe('column');
  await act(() =>
    Dimensions.set({
      window: viewport(1040, 1.5),
      screen: viewport(1040, 1.5),
    }),
  );
  await measureBrowser(1000);
  expect(layoutDirection()).toBe('column');
  await act(() =>
    Dimensions.set({ window: viewport(540, 1.5), screen: viewport(540, 1.5) }),
  );
  await measureBrowser(500);
  expect(layoutDirection()).toBe('column');

  expect(view.getByTestId('manual-history-scroll')).toBeTruthy();
  expect(view.getByTestId('manual-history-detail')).toBeTruthy();
  expect(view.getByTestId('manual-history-correction-history')).toBeTruthy();
  expect(view.getByTestId('manual-history-delete-confirmation')).toBeTruthy();
  expect(
    view.getByTestId('manual-history-version-' + original.id),
  ).toBeTruthy();
  expect(
    view.getByTestId('manual-history-version-' + corrected.id),
  ).toBeTruthy();

  await fireEvent.press(view.getByTestId('manual-history-cancel-delete'));
  expect(view.getByTestId('manual-history-delete')).toBeTruthy();
  await act(() =>
    Dimensions.set({
      window: viewport(1040, 1.5),
      screen: viewport(1040, 1.5),
    }),
  );
  await measureBrowser(1000);
  expect(layoutDirection()).toBe('column');
  expect(view.getByTestId('manual-history-close-details')).toBeTruthy();
});
