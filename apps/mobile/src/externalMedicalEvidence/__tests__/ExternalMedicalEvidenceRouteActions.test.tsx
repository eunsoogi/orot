import { fireEvent, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { ExternalMedicalEvidenceScreen } from '../ExternalMedicalEvidenceScreen';

test('search from the dock retains query trimming and explicit consent', async () => {
  const service = {
    search: jest.fn(async () => ({ status: 'empty' as const })),
  };
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('evidence');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <ExternalMedicalEvidenceScreen
          service={service}
          onBack={jest.fn()}
          onOpenArticle={jest.fn()}
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
  await renderWithRootSafeArea(<Fixture />);
  expect(screen.getByTestId('dock-search-evidence')).toBeDisabled();
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    '  synthetic query  ',
  );
  expect(screen.queryByTestId('external-evidence-search')).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-search-evidence'));
  expect(service.search).not.toHaveBeenCalled();
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  expect(service.search).toHaveBeenCalledWith('synthetic query', {
    externalQueryConsented: true,
    signal: expect.any(AbortSignal),
  });
});
