import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { HealthRecordsLibraryHeader } from '../HealthRecordsLibraryHeader';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';

test('moves the whole-list retry while retaining pagination recovery inline', async () => {
  const retry = jest.fn();
  function Fixture({ whole }: { whole: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('library');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <View testID="header">
          <HealthRecordsLibraryHeader
            hasSharedNavigation
            loadState="failed"
            observationCount={0}
            selectedCategory="all"
            onBack={jest.fn()}
            onRetry={retry}
            onSelectCategory={jest.fn()}
            retryInDock={whole}
          />
        </View>
        <View>
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
              onPress={() => {
                action.onPress();
              }}
            />
          ))}
        </View>
      </NavigationPrimaryActionContext.Provider>
    );
  }
  const view = await render(<Fixture whole />);
  expect(
    within(screen.getByTestId('header')).queryByTestId('health-records-retry'),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-retry-health-library'));
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(<Fixture whole={false} />);
  expect(screen.queryByTestId('dock-retry-health-library')).toBeNull();
  expect(
    within(screen.getByTestId('header')).getByTestId('health-records-retry'),
  ).toBeTruthy();
});

test('routes the library import entry through its existing navigation callback', async () => {
  const open = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('library');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <HealthRecordsLibraryScreen
          loadObservations={async () => ({ records: [], nextCursor: null })}
          onBack={jest.fn()}
          onOpenHealthImport={open}
          onOpenDetail={jest.fn()}
        />
        <View>
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
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
  expect(screen.queryByTestId('health-records-open-health-import')).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-open-health-import'));
  expect(open).toHaveBeenCalledTimes(1);
});
