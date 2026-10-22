import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SelectedModelControl } from '../SelectedModelControl';

/** One shared presentation prevents feature-specific model cards from drifting apart. */
test('keeps the actual model name and a 44-point accessible selection target', async () => {
  const onPress = jest.fn();
  await render(
    <SelectedModelControl
      name="GPT-6-Luna"
      local={false}
      label="AI 선택, GPT-6-Luna"
      onPress={onPress}
    />,
  );
  const button = screen.getByRole('button', { name: 'AI 선택, GPT-6-Luna' });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({
    minHeight: 44,
  });
  expect(screen.getByText('GPT-6-Luna')).toBeTruthy();
  expect(screen.queryByText('사용할 AI')).toBeNull();
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('does not promise model selection on an informational calendar display', async () => {
  await render(<SelectedModelControl name="Apple Intelligence" local />);
  expect(screen.getByText('Apple Intelligence')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
