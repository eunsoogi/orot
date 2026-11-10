import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  bindRecordingToVisit,
  cacheRecapResult,
  loadCurrentRecapInput,
  markRecapSaved,
  readCurrentRecapResult,
  createVisitQuestionRecordRepository,
} from '@orot/storage';
import { setupAutomatic } from '../../../../../packages/storage/__tests__/visitQuestionAutomaticSupport';
import { RetainedManualVisitTargets } from '../RetainedManualVisitTargets';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { recordingService } from '../../recording/recordingService';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../recording/recordingService', () => ({
  recordingService: { playRange: jest.fn(async () => ({})) },
}));
jest.mock('../ManualVisitRecords', () => ({ ManualVisitRecords: () => null }));

it('restores a validated retained visit and opens its saved audio range', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'retained-recap-'));
  const path = join(directory, 'records.sqlite');
  const fixture = await setupAutomatic(path);
  let reopened: ReturnType<typeof openSqliteTestDatabase> | null = null;
  try {
    const source = fixture.result.recordingSourceId;
    const appointmentId = fixture.result.appointmentId;
    await bindRecordingToVisit(fixture.database, source, appointmentId);
    const input = (await loadCurrentRecapInput(fixture.database, source))!;
    const result = { ...fixture.result, binding: input.binding };
    await cacheRecapResult(fixture.database, result);
    await fixture.official.saveAutomatic(result, {
      loadCurrentInput: async sql =>
        (await loadCurrentRecapInput(sql, source))!,
    });
    await markRecapSaved(fixture.database, result);
    fixture.close();
    reopened = openSqliteTestDatabase(path);
    expect(await readCurrentRecapResult(reopened.database, source)).toEqual(
      result,
    );
    expect(
      await createVisitQuestionRecordRepository(
        reopened.database,
      ).listForAppointment(appointmentId),
    ).toHaveLength(1);
    jest
      .mocked(openLocalAgentMemoryDatabase)
      .mockResolvedValue(reopened.database);
    const discovery = {
      activeSessionVersion: jest.fn().mockResolvedValue(0),
      readSession: jest.fn().mockResolvedValue({
        items: [
          { id: 'turn', revision: '1', visitQuestions: { appointmentId } },
        ],
        unavailableCount: 0,
        nextCursor: null,
      }),
      revalidateSession: jest.fn().mockResolvedValue(true),
    };
    const view = await render(
      <RetainedManualVisitTargets
        sessionId="session"
        discover={jest.fn().mockResolvedValue(discovery)}
        excluded="[]"
        loadRecapDatabase={async () => reopened!.database}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('자동 저장된 진료 요약')).toBeTruthy(),
    );
    await fireEvent.press(screen.getByText('원본 녹음 듣기'));
    const range = result.questions[0].answers[0].evidence[0].audioRange;
    expect(recordingService.playRange).toHaveBeenCalledWith(
      source,
      range.startMs,
      range.endMs,
    );
    await act(async () => {
      view.unmount();
    });
  } finally {
    reopened?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
