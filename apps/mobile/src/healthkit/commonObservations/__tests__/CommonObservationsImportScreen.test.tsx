import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../../layout/appColors';
import {
  CommonObservationsImportScreen,
  type CommonObservationsImportCopy,
} from '../CommonObservationsImportScreen';

const copy: CommonObservationsImportCopy = {
  title: '건강 기록 가져오기',
  description: '가져올 기록을 선택해 주세요.',
  localOnly: '선택한 기록은 이 기기에 저장돼요.',
  importButton: '선택한 기록 가져오기',
  featureNames: { heartRate: '심박수', steps: '걸음 수', bodyMass: '체중' },
  statuses: {
    idle: '기록 유형을 선택해 주세요.',
    importing: '가져오는 중이에요.',
    complete: '가져왔어요.',
    empty: '새로운 변경이 없어요.',
    unavailable: 'HealthKit을 사용할 수 없어요.',
    unsupportedFeature: '이 기록 유형은 지원하지 않아요.',
    unsupportedPlatform: '이 플랫폼은 지원하지 않아요.',
    unsupportedData: '처리할 수 없는 기록이에요.',
    partial: '일부 기록만 가져왔어요.',
    failed: '가져오지 못했어요.',
  },
  changeSummary: (imported, deleted, unsupported) =>
    `${imported}개 저장, ${deleted}개 삭제, ${unsupported}개 미지원`,
};

test('keeps HealthKit copy readable and uses a high-contrast primary import action', async () => {
  const onImport = jest.fn(async () => ({
    status: 'complete' as const,
    importedCount: 1,
    deletedCount: 0,
    unsupportedCount: 0,
  }));
  await render(
    <CommonObservationsImportScreen copy={copy} onImport={onImport} />,
  );

  expect(
    StyleSheet.flatten(screen.getByText(copy.description).props.style).color,
  ).toBe(appColors.text);
  const importAction = screen.getByTestId('common-observations-import');
  expect(importAction).toBeDisabled();
  expect(
    screen.getByTestId('common-observations-indicator-heartRate'),
  ).toBeTruthy();
  expect(screen.queryByText('☐ 심박수')).toBeNull();

  await fireEvent.press(
    screen.getByTestId('common-observations-toggle-heartRate'),
  );
  expect(
    screen.getByTestId('common-observations-toggle-heartRate').props
      .accessibilityState.checked,
  ).toBe(true);
  expect(importAction).not.toBeDisabled();
  expect(StyleSheet.flatten(importAction.props.style).backgroundColor).toBe(
    appColors.primaryAction,
  );
  expect(
    StyleSheet.flatten(screen.getByText(copy.importButton).props.style).color,
  ).toBe(appColors.onPrimary);

  await fireEvent.press(importAction);
  expect(onImport).toHaveBeenCalledWith(['heartRate']);
});
