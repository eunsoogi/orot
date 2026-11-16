import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import { getRagConversationCopy } from '../copy';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';

test('keeps retired session controls absent during iPhone geometry and input focus changes', async () => {
  const onOpenHistory = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('conversation');
    return (
      <NavigationGeometryProvider>
        <NavigationPrimaryActionContext.Provider value={host}>
          <ConversationScreen
            navigationRouteKey="conversation"
            onBack={jest.fn()}
            onOpenHistory={onOpenHistory}
            onOpenSource={jest.fn()}
            onSend={jest.fn()}
          />
          <View>
            {actions.map(action => (
              <Button
                key={action.id}
                title={action.label}
                testID={`dock-${action.id}`}
                onPress={action.onPress}
              />
            ))}
          </View>
        </NavigationPrimaryActionContext.Provider>
      </NavigationGeometryProvider>
    );
  }

  await render(<Fixture />);
  const copy = getRagConversationCopy();
  expect(screen.queryByTestId('dock-conversation-history')).toBeNull();
  expect(screen.queryByTestId('dock-new-conversation')).toBeNull();
  expect(screen.queryByLabelText(copy.sessions)).toBeNull();
  expect(screen.queryByLabelText(copy.newConversation)).toBeNull();

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    {
      nativeEvent: {
        windowBounds: { x: 0, y: 0, width: 390, height: 844 },
        safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
        reservedRegionsSupported: true,
        hasHinge: false,
        reservedRegions: [],
      },
    },
  );
  expect(screen.queryByTestId('dock-conversation-history')).toBeNull();
  expect(screen.queryByLabelText(copy.sessions)).toBeNull();
  expect(screen.queryByLabelText(copy.newConversation)).toBeNull();

  await fireEvent(screen.getByTestId('rag-conversation-input'), 'focus');
  expect(screen.queryByLabelText(copy.sessions)).toBeNull();
  expect(screen.queryByLabelText(copy.newConversation)).toBeNull();
  expect(onOpenHistory).not.toHaveBeenCalled();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
});
