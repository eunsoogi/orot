import { fireEvent, render, screen } from '@testing-library/react-native';
import type { NavigationLeaveState } from '../../../navigation/navigationLeaveGuard';
import {
  NavigationLeaveStateRegistrationProvider,
  type NavigationLeaveStateRegistration,
} from '../../../navigation';
import {
  CommonObservationsImportScreen,
  type CommonObservationsImportCopy,
  type CommonObservationsImportResult,
} from '../CommonObservationsImportScreen';

const copy: CommonObservationsImportCopy = {
  title: '건강 기록 가져오기',
  description: '가져올 기록을 선택해 주세요.',
  localOnly: '선택한 기록은 이 기기에 저장돼요.',
  importButton: '선택한 기록 가져오기',
  featureNames: { heartRate: '심박수', steps: '걸음 수', bodyMass: '체중' },
  statuses: {
    idle: '선택해 주세요.',
    importing: '가져오는 중이에요.',
    complete: '가져왔어요.',
    empty: '변경이 없어요.',
    unavailable: '사용할 수 없어요.',
    unsupportedFeature: '지원하지 않아요.',
    unsupportedPlatform: '이 기기를 지원하지 않아요.',
    unsupportedData: '데이터를 지원하지 않아요.',
    partial: '일부만 가져왔어요.',
    failed: '가져오지 못했어요.',
  },
  changeSummary: () => '',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('registers selected input and an import that continues after leaving', async () => {
  let registered: { readState: () => NavigationLeaveState } | undefined;
  const registerLeaveState: NavigationLeaveStateRegistration = source => {
    registered = source;
    return () => {};
  };
  const result = deferred<CommonObservationsImportResult>();
  const onImport = jest.fn(() => result.promise);
  await render(
    <NavigationLeaveStateRegistrationProvider
      registerLeaveState={registerLeaveState}
    >
      <CommonObservationsImportScreen copy={copy} onImport={onImport} />
    </NavigationLeaveStateRegistrationProvider>,
  );

  const readState = () => {
    if (!registered) throw new Error('Leave state was not registered.');
    return registered.readState();
  };
  expect(readState()).toMatchObject({
    canLeave: true,
    hasUnsavedChanges: false,
    backgroundOperationKind: undefined,
  });

  await fireEvent.press(
    screen.getByTestId('common-observations-toggle-heartRate'),
  );
  expect(readState()).toMatchObject({
    hasUnsavedChanges: true,
    inputRevision: 1,
  });
  await fireEvent.press(screen.getByTestId('common-observations-import'));

  expect(onImport).toHaveBeenCalledWith(['heartRate']);
  expect(readState()).toMatchObject({
    canLeave: true,
    hasUnsavedChanges: false,
    hasOngoingOperation: false,
    backgroundOperationKind: 'common-observation-import',
  });

  result.resolve({
    status: 'complete',
    importedCount: 1,
    deletedCount: 0,
    unsupportedCount: 0,
  });
  expect(await screen.findByText('가져왔어요.')).toBeTruthy();
  expect(readState().backgroundOperationKind).toBeUndefined();
});
