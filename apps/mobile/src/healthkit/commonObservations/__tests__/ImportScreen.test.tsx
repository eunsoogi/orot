import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  CommonObservationsImportScreen,
  type CommonObservationsImportCopy,
} from '../CommonObservationsImportScreen';

const copy: CommonObservationsImportCopy = {
  title: '건강 기록 가져오기',
  description: '가져올 기록을 선택해 주세요.',
  localOnly: '선택한 기록은 이 기기에 저장돼요.',
  importButton: '선택한 기록 가져오기',
  featureNames: {
    heartRate: '심박수',
    steps: '걸음 수',
    bodyMass: '체중',
  },
  statuses: {
    idle: '가져올 기록을 선택해 주세요.',
    importing: '가져오는 중이에요.',
    complete: '가져오기를 마쳤어요.',
    empty: '새로운 변경이 없어요. 읽기 권한 상태는 확인할 수 없어요.',
    unavailable: 'HealthKit을 사용할 수 없어요.',
    unsupportedFeature: '선택한 건강 기록 유형은 지원하지 않아요.',
    unsupportedPlatform: '이 기기에서는 HealthKit을 지원하지 않아요.',
    unsupportedData: '지원할 수 없는 건강 기록이 있어 가져오기를 멈췄어요.',
    partial: '일부 기록만 가져왔어요. 다시 시도해 주세요.',
    failed: '기록을 가져오지 못했어요. 다시 시도해 주세요.',
  },
  changeSummary: (imported, deleted, unsupported) =>
    `${imported}개 저장, ${deleted}개 삭제, ${unsupported}개 미지원`,
};

describe('common observations import screen', () => {
  it('requires explicit type selection and sends only selected types', async () => {
    const onImport = jest.fn().mockResolvedValue({
      status: 'complete',
      importedCount: 2,
      deletedCount: 1,
      unsupportedCount: 0,
    });
    await render(
      <CommonObservationsImportScreen copy={copy} onImport={onImport} />,
    );

    expect(screen.getByText('선택한 기록은 이 기기에 저장돼요.')).toBeTruthy();
    expect(screen.getByTestId('common-observations-import')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('common-observations-import'));
    expect(onImport).not.toHaveBeenCalled();

    await fireEvent.press(
      screen.getByTestId('common-observations-toggle-heartRate'),
    );
    await fireEvent.press(
      screen.getByTestId('common-observations-toggle-steps'),
    );
    await fireEvent.press(screen.getByTestId('common-observations-import'));

    expect(onImport).toHaveBeenCalledWith(['heartRate', 'steps']);
    expect(
      await screen.findByText(
        '가져오기를 마쳤어요. 2개 저장, 1개 삭제, 0개 미지원',
      ),
    ).toBeTruthy();
  });

  it('does not turn an empty visible result into a denial claim', async () => {
    const onImport = jest.fn().mockResolvedValue({
      status: 'empty',
      importedCount: 0,
      deletedCount: 0,
      unsupportedCount: 0,
    });
    await render(
      <CommonObservationsImportScreen copy={copy} onImport={onImport} />,
    );

    await fireEvent.press(
      screen.getByTestId('common-observations-toggle-bodyMass'),
    );
    await fireEvent.press(screen.getByTestId('common-observations-import'));

    expect(
      await screen.findByText(
        /새로운 변경이 없어요\..*읽기 권한 상태는 확인할 수 없어요\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/거부/)).toBeNull();
  });

  it.each([
    ['unavailable', 'HealthKit을 사용할 수 없어요.'],
    ['unsupportedFeature', '선택한 건강 기록 유형은 지원하지 않아요.'],
    ['unsupportedPlatform', '이 기기에서는 HealthKit을 지원하지 않아요.'],
    ['unsupportedData', '지원할 수 없는 건강 기록이 있어 가져오기를 멈췄어요.'],
    ['partial', '일부 기록만 가져왔어요. 다시 시도해 주세요.'],
  ] as const)(
    'shows %s separately from an empty result',
    async (status, message) => {
      const onImport = jest.fn().mockResolvedValue({
        status,
        importedCount: 0,
        deletedCount: 0,
        unsupportedCount: 0,
      });
      await render(
        <CommonObservationsImportScreen copy={copy} onImport={onImport} />,
      );

      await fireEvent.press(
        screen.getByTestId('common-observations-toggle-heartRate'),
      );
      await fireEvent.press(screen.getByTestId('common-observations-import'));

      expect(
        await screen.findByText(`${message} 0개 저장, 0개 삭제, 0개 미지원`),
      ).toBeTruthy();
      expect(screen.queryByText(copy.statuses.empty)).toBeNull();
    },
  );

  it('shows a neutral failure status when the importer rejects', async () => {
    const onImport = jest
      .fn()
      .mockRejectedValue(new Error('private native detail'));
    await render(
      <CommonObservationsImportScreen copy={copy} onImport={onImport} />,
    );

    await fireEvent.press(
      screen.getByTestId('common-observations-toggle-heartRate'),
    );
    await fireEvent.press(screen.getByTestId('common-observations-import'));

    expect(await screen.findByText(copy.statuses.failed)).toBeTruthy();
    expect(screen.queryByText(/private native detail/)).toBeNull();
  });
});
