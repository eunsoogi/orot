import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

/** Match the pushed Settings screens without shifting the shared rail or scroll owner. */
export function expectMetricEditorInsets() {
  const editor = screen.getByTestId('overview-metric-selection-screen');
  expect(StyleSheet.flatten(editor.props.style)).toMatchObject({
    paddingHorizontal: 20,
    paddingTop: 16,
  });
  expect(editor).toContainElement(
    screen.getByRole('header', { name: '건강 지표 편집' }),
  );
}
