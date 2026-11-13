import { fireEvent, render, screen } from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { ManualVisitRecords } from '../ManualVisitRecords';
import { createManualVisitRecords } from '../manualVisitRecordService';

/** The real component and SQLite repository share a synthetic visit with no recording or model. */
test('confirms an asked question and answer without a recording and reopens them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-visit-recording-free-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const records = createRecordRepository(connection.database);
    const time = '2035-01-02T00:00:00Z';
    const metadata = {
      effectiveAt: time,
      recordedAt: time,
      ingestedAt: time,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await records.put('appointment', {
      ...metadata,
      id: 'visit-synthetic',
      status: 'scheduled',
    });
    await records.put('visit_question', {
      ...metadata,
      id: 'question-synthetic',
      appointmentId: 'visit-synthetic',
      questionText: '합성 질문을 어떻게 확인할까요?',
      priority: 'routine',
      evidenceSpanIds: [],
    });
    const service = createManualVisitRecords(connection.database);
    const open = async () => service;
    const view = await render(
      <ManualVisitRecords appointmentId="visit-synthetic" open={open} />,
    );
    await screen.findByText('합성 질문을 어떻게 확인할까요?');
    expect((await service.load('visit-synthetic'))[0]!.records).toEqual([]);
    await fireEvent.press(screen.getByText('실제로 물어봤어요'));
    await fireEvent.changeText(
      screen.getByLabelText('의료진 답변'),
      '합성 답변을 확인했어요.',
    );
    await fireEvent.press(screen.getByText('저장'));
    await screen.findByText('합성 답변을 확인했어요.');
    await screen.findByText('질문을 물어봤어요');
    const [saved] = (await service.load('visit-synthetic'))[0]!.records;
    expect(saved).toMatchObject({
      appointmentId: 'visit-synthetic',
      questionId: 'question-synthetic',
      questionText: '합성 질문을 어떻게 확인할까요?',
      answer: '합성 답변을 확인했어요.',
      sourceMethod: 'manual_confirmed',
      editOrigin: 'manual_confirmation',
      revision: 1,
    });
    expect(await records.list('source_record')).toEqual([]);
    view.unmount();
    connection.close();

    // Reopen the same file with a new repository and component; this is not a new app process.
    connection = openSqliteTestDatabase(path);
    const reopened = createManualVisitRecords(connection.database);
    expect((await reopened.load('visit-synthetic'))[0]!.records).toEqual([
      saved,
    ]);
    const reopenedView = await render(
      <ManualVisitRecords
        appointmentId="visit-synthetic"
        open={async () => reopened}
      />,
    );
    await screen.findByText('합성 질문을 어떻게 확인할까요?');
    await screen.findByText('합성 답변을 확인했어요.');
    await screen.findByText('질문을 물어봤어요');
    expect(screen.queryByText('실제로 물어봤어요')).toBeNull();
    expect(screen.getByText('답변 수정')).toBeTruthy();
    reopenedView.unmount();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
