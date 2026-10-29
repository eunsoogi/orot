import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import { appColors } from '../src/layout/appColors';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

// Inline expansion must keep a selected record next to its own metadata in every window size.
test('expands details inside the selected card and uses one keyboard-aware page', async () => {
  const repository = createManualHistoryTestRepository();
  const entry = await repository.create({
    kind: 'note',
    title: 'Synthetic inline record',
    details: 'Synthetic details.',
    effectiveDate: { status: 'unknown' },
  });
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );
  await fireEvent.press(
    await view.findByTestId('manual-history-details-' + entry.id),
  );
  expect(
    within(view.getByTestId('manual-history-entry-' + entry.id)).getByTestId(
      'manual-history-detail',
    ),
  ).toBeTruthy();
  expect(view.getAllByTestId(/scroll$/)).toHaveLength(1);
  expect(
    view.getByTestId('manual-history-scroll').props
      .automaticallyAdjustKeyboardInsets,
  ).toBe(true);
  expect(
    StyleSheet.flatten(
      view.getByTestId('manual-history-entry-' + entry.id).props.style,
    ).backgroundColor,
  ).toEqual(appColors.surface);
});

test('lets the detail field grow in the page and exposes themed required-field errors', async () => {
  const view = await render(
    <ManualHistoryScreen
      onBack={jest.fn()}
      repository={createManualHistoryTestRepository()}
    />,
  );
  await fireEvent.press(await view.findByTestId('manual-history-add'));
  const details = view.getByTestId('manual-history-details-input');
  expect(details.props.scrollEnabled).toBe(false);
  await fireEvent(details, 'contentSizeChange', {
    nativeEvent: { contentSize: { height: 340, width: 200 } },
  });
  expect(
    StyleSheet.flatten(
      view.getByTestId('manual-history-details-input').props.style,
    ).minHeight,
  ).toBeGreaterThanOrEqual(340);
  await fireEvent.press(view.getByTestId('manual-history-save'));
  const error = view.getByTestId('manual-history-validation-error');
  expect(error.props.accessibilityLiveRegion).toBe('assertive');
  expect(StyleSheet.flatten(error.props.style).color).toEqual(appColors.danger);
});
