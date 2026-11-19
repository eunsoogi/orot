import { fireEvent, render } from '@testing-library/react-native';
import { AppearanceEditor } from '../AppearanceEditor';
import { appearanceStore } from '../appearanceStore';

jest.mock('../appearanceStore', () => ({
  appearanceStore: { save: jest.fn() },
}));
jest.mock(
  '../../layout/SafeAreaLayout',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      children,
);
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

// Stable AX identifiers identify the existing radio controls; they must not
// preselect an avatar, change its spoken label, or bypass explicit Save.
test('stable star identifier preserves label, radio selection, and explicit save', async () => {
  const saved = { avatar: 'star' as const, name: null };
  jest.mocked(appearanceStore.save).mockResolvedValue(saved);
  const onSave = jest.fn();
  const view = await render(<AppearanceEditor onSave={onSave} />);
  const star = view.getByTestId('assistant-appearance-avatar-star');
  expect(star).toBe(view.getByRole('radio', { name: '별' }));
  expect(star.props.accessibilityState.checked).toBe(false);
  expect(
    view.getByTestId('assistant-appearance-save').props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(appearanceStore.save).not.toHaveBeenCalled();
  await fireEvent.press(star);
  expect(
    view.getByRole('radio', { name: '별' }).props.accessibilityState.checked,
  ).toBe(true);
  expect(
    view.getByRole('radio', { name: '기본' }).props.accessibilityState.checked,
  ).toBe(false);
  expect(appearanceStore.save).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('assistant-appearance-save'));
  expect(appearanceStore.save).toHaveBeenCalledTimes(1);
  expect(appearanceStore.save).toHaveBeenCalledWith(saved);
  expect(onSave).toHaveBeenCalledWith(saved);
});
