import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { ConversationHistoryListPane } from '../ConversationHistoryListPane';

test('moves creation to the dock and hides the duplicate page button', async () => {
  const create = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('history');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <ConversationHistoryListPane
          deleted={false}
          rows={[]}
          onCreateSession={create}
          onDeleteSession={jest.fn()}
          onSelectSession={jest.fn()}
          onUndoRemove={jest.fn()}
        />
        <View>
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
              disabled={action.disabled}
              onPress={() => {
                action.onPress();
              }}
            />
          ))}
        </View>
      </NavigationPrimaryActionContext.Provider>
    );
  }
  await render(<Fixture />);
  expect(screen.queryByTestId('conversation-history-new')).toBeNull();
  expect(screen.getByTestId('conversation-history-header')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('dock-new-history-session'));
  expect(create).toHaveBeenCalledTimes(1);
});
