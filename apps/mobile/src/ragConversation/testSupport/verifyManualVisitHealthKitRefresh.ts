import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { RecordRepository } from '@orot/storage';
import { applyBloodPressureChanges } from '../../healthkit/bloodPressure/importChanges';
import { correlation } from '../../healthkit/bloodPressure/testSupport';
import { openManualVisitRecords } from '../manualVisitRecordService';

/** Drives a real importer transaction while the restored visit editor is mounted. */
export async function verifyManualVisitHealthKitRefresh(
  repository: RecordRepository,
) {
  const id = 'unrelated-pressure';
  const now = () => '2026-10-07T04:00:00.000Z';
  const base = {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    hasMore: false,
  } as const;
  await applyBloodPressureChanges(
    repository,
    {
      ...base,
      addedSamples: [correlation(id)],
      deletedSampleIds: [],
      cursor: 'one',
    },
    null,
    now,
  );

  await fireEvent.press(screen.getByText('답변 수정'));
  await fireEvent.changeText(
    screen.getByLabelText('의료진 답변'),
    '재열기 후 수정',
  );
  const opens = jest.mocked(openManualVisitRecords).mock.calls.length;
  await act(async () => {
    const result = await applyBloodPressureChanges(
      repository,
      { ...base, addedSamples: [], deletedSampleIds: [id], cursor: 'two' },
      'one',
      now,
    );
    expect(result.deleted).toBe(2);
  });
  await waitFor(() => {
    expect(
      jest.mocked(openManualVisitRecords).mock.calls.length,
    ).toBeGreaterThan(opens);
    expect(screen.getByLabelText('의료진 답변').props.value).toBe(
      '재열기 후 수정',
    );
  });
}
