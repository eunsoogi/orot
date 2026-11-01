import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../../navigation/useNavigationPrimaryAction';
import { healthKitFeatures } from '../../types';
import {
  HealthKitImportScreen,
  type HealthKitImportScreenCopy,
} from '../HealthKitImportScreen';
import { createUnifiedImportCoordinator } from '../coordinator';
import { createTestServices, deferred } from '../testSupport';

const copy: HealthKitImportScreenCopy = {
  title: '가져오기',
  description: '항목 선택',
  sourceSelectionTitle: '출처',
  activityTitle: '진행 상황',
  localOnly: '기기에 저장',
  readAuthorization: '권한',
  importButton: '가져오기',
  cancelButton: '취소',
  featureNames: Object.fromEntries(
    healthKitFeatures.map(feature => [feature, feature]),
  ) as HealthKitImportScreenCopy['featureNames'],
  featureStatuses: {} as HealthKitImportScreenCopy['featureStatuses'],
  phaseStatuses: {
    queued: '대기',
    authorizingEventKit: '승인',
    queryingEventKit: '조회',
    cancelling: '취소 중',
  } as HealthKitImportScreenCopy['phaseStatuses'],
  changeSummary: () => '',
};

test('coalesces immediate starts and exposes cancel while the real coordinator runs', async () => {
  const base = createTestServices();
  const pending =
    deferred<
      Awaited<ReturnType<typeof base.services.eventKit.listUpcomingEvents>>
    >();
  const coordinator = createUnifiedImportCoordinator({
    ...base.services,
    eventKit: {
      ...base.services.eventKit,
      listUpcomingEvents: () => pending.promise,
    },
  });
  const start = jest.spyOn(coordinator, 'start');
  let invoke: (() => void | Promise<unknown>) | undefined;
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('import');
    invoke = actions.find(action => action.id === 'start-import')?.onPress;
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <HealthKitImportScreen copy={copy} coordinator={coordinator} />
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
  expect(screen.getByTestId('dock-start-import')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('unified-import-toggle-eventKit'));
  await act(async () => {
    invoke?.();
    invoke?.();
  });
  expect(start).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('dock-start-import')).toBeDisabled();
  expect(screen.getByTestId('dock-cancel-import')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('dock-cancel-import'));
  await act(async () => pending.resolve({ access: 'fullAccess', events: [] }));
});
