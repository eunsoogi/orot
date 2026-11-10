import {
  bindRecordingToVisit,
  cacheRecapResult,
  loadCurrentRecapInput,
  markRecapSaved,
} from '@orot/storage';
import { setupAutomatic } from '../../../../../packages/storage/__tests__/visitQuestionAutomaticSupport';
import { createManualVisitRecords } from '../manualVisitRecordService';

it.each([false, true])(
  'handles stale automatic records with user edit: %s',
  async edited => {
    const fixture = await setupAutomatic();
    try {
      const source = fixture.result.recordingSourceId;
      await bindRecordingToVisit(
        fixture.database,
        source,
        fixture.result.appointmentId,
      );
      const input = (await loadCurrentRecapInput(fixture.database, source))!;
      const result = { ...fixture.result, binding: input.binding };
      await cacheRecapResult(fixture.database, result);
      await fixture.official.saveAutomatic(result, {
        loadCurrentInput: async sql =>
          (await loadCurrentRecapInput(sql, source))!,
      });
      await markRecapSaved(fixture.database, result);
      const service = createManualVisitRecords(fixture.database);
      const initial = (await service.load(result.appointmentId))[0].records;
      expect(initial).toHaveLength(1);
      if (edited)
        await fixture.official.edit({
          id: initial[0].id,
          expectedRevision: initial[0].revision,
          answer: '내가 수정한 답변',
        });
      await fixture.records.transcripts.correct(
        input.segments[0].id,
        '수정된 전사',
        '2026-11-06T00:00:00Z',
      );
      const stale = (await service.load(result.appointmentId))[0];
      if (edited) {
        expect(stale.records[0].answer).toBe('내가 수정한 답변');
        expect(stale.staleAutomaticIds).toContain(initial[0].id);
      } else expect(stale.records).toHaveLength(0);
      expect(
        await fixture.official.listForAppointment(result.appointmentId),
      ).toHaveLength(1);
    } finally {
      fixture.close();
    }
  },
);
