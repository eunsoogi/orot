import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { CheckboxIndicator, checkboxSymbolName } from '../CheckboxIndicator';

jest.mock('../AppSymbol', () => ({
  AppSymbol: ({ name, size }: { name: string; size: number }) =>
    require('react').createElement(require('react-native').View, {
      accessibilityLabel: name,
      style: { width: size, height: size },
      testID: 'checkbox-native-symbol',
    }),
}));

test('uses a large icon inside the minimum checkbox target', async () => {
  const view = await render(
    <CheckboxIndicator checked="mixed" testID="checkbox-indicator" />,
  );
  expect(
    StyleSheet.flatten(view.getByTestId('checkbox-indicator').props.style),
  ).toMatchObject({ width: 44, height: 44 });
  expect(
    StyleSheet.flatten(
      view.getByTestId('checkbox-indicator-glyph').props.style,
    ),
  ).toMatchObject({ width: 26, height: 26 });
  expect(
    view.getByTestId('checkbox-native-symbol').props.accessibilityLabel,
  ).toBe('minus.square.fill');
  expect(checkboxSymbolName(false)).toBe('square');
  expect(checkboxSymbolName(true)).toBe('checkmark.square.fill');
});

test('dims the decorative icon while the parent control owns disabled semantics', async () => {
  const view = await render(
    <CheckboxIndicator checked testID="disabled-checkbox" disabled />,
  );
  expect(
    StyleSheet.flatten(view.getByTestId('disabled-checkbox').props.style),
  ).toMatchObject({ opacity: 0.45 });
});
