import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { ConversationHistoryListPane } from '../ConversationHistoryListPane';

test('moves creation to the dock and tells the native list to hide its duplicate button', async () => {
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
  expect(
    screen.getByTestId('conversation-history-list').props.showsNewSession,
  ).toBe(false);
  await fireEvent.press(screen.getByTestId('dock-new-history-session'));
  expect(create).toHaveBeenCalledTimes(1);
});
