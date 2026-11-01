import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import RecordingScreenHeader from '../RecordingScreenHeader';
import RecordingLibraryList from '../RecordingLibraryList';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

test('moves recording history and new-recording entry without changing busy guards', async () => {
  const history = jest.fn();
  const create = jest.fn();
  function Fixture({ library, busy }: { library: boolean; busy: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('recording');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        {library ? (
          <RecordingLibraryList
            recordings={[]}
            loading={false}
            loadError={false}
            disabled={busy}
            onOpen={jest.fn()}
            onDelete={jest.fn()}
            onNewRecording={create}
          />
        ) : (
          <RecordingScreenHeader
            controlsBusy={busy}
            onOpenSavedRecordings={history}
            sourceRetryPending={false}
            stateReady
            status="idle"
          />
        )}
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
  const view = await render(<Fixture library={false} busy />);
  expect(screen.getByTestId('dock-recording-history')).toBeDisabled();
  await view.rerender(<Fixture library={false} busy={false} />);
  await fireEvent.press(screen.getByTestId('dock-recording-history'));
  expect(history).toHaveBeenCalledTimes(1);
  await view.rerender(<Fixture library busy={false} />);
  await fireEvent.press(screen.getByTestId('dock-new-recording'));
  expect(create).toHaveBeenCalledTimes(1);
});
