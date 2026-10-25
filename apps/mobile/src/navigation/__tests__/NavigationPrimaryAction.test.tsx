import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Text } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryAction,
  useNavigationPrimaryActionHost,
} from '../useNavigationPrimaryAction';

function DraftAction({ onSave }: { onSave: () => void }) {
  useNavigationPrimaryAction({
    label: '질문 저장',
    accessibilityLabel: '질문 저장',
    testID: 'save',
    onPress: onSave,
  });
  return null;
}

function Host({ routeKey, onSave }: { routeKey: string; onSave: () => void }) {
  const { host, action } = useNavigationPrimaryActionHost(routeKey);
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <DraftAction onSave={onSave} />
      <Text testID="active-action">{action?.label ?? 'none'}</Text>
      {action ? <Button title={action.label} onPress={action.onPress} /> : null}
    </NavigationPrimaryActionContext.Provider>
  );
}

test('restores a retained draft action after an overlay and calls the latest save handler', async () => {
  const original = jest.fn();
  const updated = jest.fn();
  const view = await render(<Host routeKey="draft" onSave={original} />);
  expect(screen.getByTestId('active-action')).toHaveTextContent('질문 저장');
  await view.rerender(<Host routeKey="source-overlay" onSave={updated} />);
  expect(screen.getByTestId('active-action')).toHaveTextContent('none');
  await view.rerender(<Host routeKey="draft" onSave={updated} />);
  await fireEvent.press(screen.getByRole('button', { name: '질문 저장' }));
  expect(updated).toHaveBeenCalledTimes(1);
  expect(original).not.toHaveBeenCalled();
});
