import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ModelSelectionSummary } from '../ModelSelectionSummary';

it('gives both model types the same readable inset without truncating long identities', async () => {
  const value = 'Synthetic model with a very long account-specific identity';
  const view = await render(
    <ModelSelectionSummary label="현재 선택:" value={value} testID="summary" />,
  );
  expect(
    StyleSheet.flatten(view.getByTestId('summary-card').props.style),
  ).toMatchObject({
    padding: 16,
    borderRadius: 20,
  });
  expect(view.getByTestId('summary')).toHaveTextContent(new RegExp(value));
  expect(view.getByTestId('summary').props.numberOfLines).toBeUndefined();
  expect(view.getByTestId('summary').props.accessibilityRole).not.toBe(
    'button',
  );
});
