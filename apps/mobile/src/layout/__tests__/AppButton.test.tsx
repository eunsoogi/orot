import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { appColors } from '../appColors';
import { AppButton } from '../AppButton';

it('keeps the default primary action accessible and leaves its callback intact', async () => {
  const onPress = jest.fn();
  const screen = await render(
    <AppButton
      accessibilityHint="Saves the current draft"
      accessibilityLabel="Save changes"
      onPress={onPress}
      title="Save"
    />,
  );
  const button = screen.getByRole('button', { name: 'Save changes' });

  expect(button.props.accessibilityHint).toBe('Saves the current draft');
  expect(button.props.accessibilityState).toEqual({
    busy: false,
    disabled: false,
  });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({
    backgroundColor: appColors.primaryAction,
    minHeight: 48,
    minWidth: 44,
  });
  expect(screen.getByText('Save').props.allowFontScaling).toBe(true);

  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('keeps compact neutral and text actions at or above the 44pt target', async () => {
  const screen = await render(
    <AppButton size="compact" title="More details" variant="neutral" />,
  );
  const neutralButton = screen.getByRole('button', { name: 'More details' });

  expect(StyleSheet.flatten(neutralButton.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
  });
  expect(
    StyleSheet.flatten(screen.getByText('More details').props.style),
  ).toMatchObject({ color: appColors.text });

  await screen.rerender(
    <AppButton size="compact" title="Previous" variant="secondary" />,
  );
  const secondaryButton = screen.getByRole('button', { name: 'Previous' });
  expect(StyleSheet.flatten(secondaryButton.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
  });
  expect(
    StyleSheet.flatten(screen.getByText('Previous').props.style),
  ).toMatchObject({ color: appColors.primaryText });

  await screen.rerender(
    <AppButton size="compact" title="Cancel" variant="text" />,
  );
  const textButton = screen.getByRole('button', { name: 'Cancel' });
  expect(StyleSheet.flatten(textButton.props.style)).toMatchObject({
    backgroundColor: 'transparent',
    minHeight: 44,
    minWidth: 44,
  });

  await screen.rerender(
    <AppButton size="compact" title="Cancel" variant="cancel" />,
  );
  expect(
    StyleSheet.flatten(
      screen.getByRole('button', { name: 'Cancel' }).props.style,
    ),
  ).toMatchObject({
    backgroundColor: 'transparent',
    minHeight: 44,
    minWidth: 44,
  });
  expect(
    StyleSheet.flatten(screen.getByText('Cancel').props.style),
  ).toMatchObject({
    color: appColors.secondary,
  });
});

it('keeps list actions in their row and presents destructive progress accessibly', async () => {
  const onPress = jest.fn();
  const screen = await render(
    <AppButton
      busy
      onPress={onPress}
      size="compact"
      testID="delete-recording"
      title="Delete recording"
      variant="destructive"
    />,
  );
  const button = screen.getByRole('button', { name: 'Delete recording' });

  expect(button.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
  });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({
    backgroundColor: appColors.dangerSurface,
    borderColor: appColors.danger,
    minHeight: 44,
    minWidth: 44,
  });
  expect(
    screen.getByTestId('delete-recording-progress', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(
    StyleSheet.flatten(screen.getByText('Delete recording').props.style),
  ).toMatchObject({ color: appColors.danger });
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();

  await screen.rerender(
    <AppButton
      accessibilityState={{ busy: true, expanded: true }}
      onPress={onPress}
      testID="delete-recording"
      title="Deleting recording"
      variant="destructive"
    />,
  );
  const accessibilityBusyButton = screen.getByRole('button', {
    name: 'Deleting recording',
  });
  expect(accessibilityBusyButton.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
    expanded: true,
  });
  expect(
    screen.getByTestId('delete-recording-progress', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  await fireEvent.press(accessibilityBusyButton);
  expect(onPress).not.toHaveBeenCalled();

  await screen.rerender(
    <AppButton size="compact" title="Open record" variant="list" />,
  );
  expect(
    StyleSheet.flatten(
      screen.getByRole('button', { name: 'Open record' }).props.style,
    ),
  ).toMatchObject({
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    minHeight: 44,
    minWidth: 44,
  });
  expect(
    StyleSheet.flatten(screen.getByText('Open record').props.style),
  ).toMatchObject({
    textAlign: 'left',
    fontWeight: '600',
  });
});

it('renders a rich list row with one accessible name and an intact callback', async () => {
  const onPress = jest.fn();
  const screen = await render(
    <AppButton
      leadingContent={<View testID="settings-provider-leading" />}
      onPress={onPress}
      size="compact"
      summary="Apple Intelligence"
      testID="settings-provider-row"
      title="AI provider and model"
      trailingContent={<View testID="settings-provider-trailing" />}
      variant="list"
    />,
  );
  const button = screen.getByRole('button', {
    name: 'AI provider and model, Apple Intelligence',
  });

  expect(button.props.testID).toBe('settings-provider-row');
  expect(button.props.accessibilityState).toMatchObject({
    busy: false,
    disabled: false,
  });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    minHeight: 44,
    minWidth: 44,
  });
  expect(
    screen.getByTestId('settings-provider-leading', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(
    screen.getByTestId('settings-provider-trailing', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(screen.getByText('AI provider and model').props.allowFontScaling).toBe(
    true,
  );
  expect(
    StyleSheet.flatten(screen.getByText('AI provider and model').props.style)
      ?.fontWeight,
  ).toBe('500');
  expect(screen.getByText('Apple Intelligence').props.allowFontScaling).toBe(
    true,
  );

  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('keeps disabled actions exposed as disabled to assistive technology', async () => {
  const onPress = jest.fn();
  const screen = await render(
    <AppButton disabled onPress={onPress} title="Unavailable" />,
  );
  const button = screen.getByRole('button', { name: 'Unavailable' });

  expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({
    opacity: 0.45,
  });
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});
