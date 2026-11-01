import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { HealthRecordsDetailHeader } from '../HealthRecordsDetailHeader';

test('registers only an initial whole-page retry and leaves period controls intact', async () => {
  const retry = jest.fn();
  function Fixture({ hasMore }: { hasMore: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('detail');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <HealthRecordsDetailHeader
          title="기록"
          hasSharedNavigation
          onBack={jest.fn()}
          selection={{ category: 'blood_pressure', period: 'month' }}
          onSelectionChange={jest.fn()}
          recordCount={0}
          observationCount={0}
          loadState="failed"
          onRetry={retry}
          hasMore={hasMore}
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
  const view = await render(<Fixture hasMore={false} />);
  expect(screen.getByTestId('health-record-period-month')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('dock-retry-health-detail'));
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(<Fixture hasMore />);
  expect(screen.queryByTestId('dock-retry-health-detail')).toBeNull();
});
