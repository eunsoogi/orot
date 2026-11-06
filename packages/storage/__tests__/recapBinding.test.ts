import {
  bindRecordingToVisit,
  cacheRecapResult,
  loadCurrentRecapInput,
  markRecapSaved,
  readCurrentRecapResult,
  readRecapBinding,
} from '../src';
import { setupAutomatic } from './visitQuestionAutomaticSupport';

it('preserves explicit selection, fences reassignment and invalidates a deleted visit', async () => {
  const fixture = await setupAutomatic();
  const { database } = fixture;
  const input = fixture.result;
  await bindRecordingToVisit(database, input.recordingSourceId, input.appointmentId);
  const first = await readRecapBinding(database, input.recordingSourceId);
  expect(first?.appointmentId).toBe(input.appointmentId);
  const snapshot = await loadCurrentRecapInput(database, input.recordingSourceId);
  expect(snapshot?.questions[0].id).toBe(input.questions[0].questionId);
  expect(snapshot?.segments[0].id).toBe(input.sources[0].segmentId);
  const result = { ...input, binding: snapshot!.binding };
  await cacheRecapResult(database, result);
  expect(await readCurrentRecapResult(database, input.recordingSourceId)).toEqual(result);
  expect((await database.execute('SELECT saved FROM recap_results')).rows[0].saved).toBe(0);
  await markRecapSaved(database, result);
  expect((await database.execute('SELECT saved FROM recap_results')).rows[0].saved).toBe(1);
  await bindRecordingToVisit(database, input.recordingSourceId, input.appointmentId);
  expect(await readRecapBinding(database, input.recordingSourceId)).toEqual(first);
  await database.execute('DELETE FROM appointments WHERE id = ?', [input.appointmentId]);
  expect(await readRecapBinding(database, input.recordingSourceId)).toBeNull();
  expect(await readCurrentRecapResult(database, input.recordingSourceId)).toBeNull();
  await expect(
    bindRecordingToVisit(database, input.recordingSourceId, input.appointmentId),
  ).rejects.toThrow();
});

it('removes cached transcript-derived output when a prepared question changes', async () => {
  const fixture = await setupAutomatic();
  const { database, result } = fixture;
  await bindRecordingToVisit(database, result.recordingSourceId, result.appointmentId);
  const snapshot = await loadCurrentRecapInput(database, result.recordingSourceId);
  const current = { ...result, binding: snapshot!.binding };
  await cacheRecapResult(database, current);
  await markRecapSaved(database, current);
  await database.execute(
    "UPDATE visit_questions SET payload_json = json_set(payload_json, '$.questionText', ?) WHERE id = ?",
    ['수정된 질문', result.questions[0].questionId],
  );
  expect(await readCurrentRecapResult(database, result.recordingSourceId)).toBeNull();
  await expect(markRecapSaved(database, current)).rejects.toThrow();
  expect((await database.execute('SELECT recording_id FROM recap_results')).rows).toHaveLength(0);
  expect(
    (await database.execute('SELECT work_status FROM recap_bindings')).rows[0].work_status,
  ).toBe('pending');
  fixture.close();
});

it('rejects stale results and rolls back the attempted cache write', async () => {
  const fixture = await setupAutomatic();
  const { database, result } = fixture;
  await bindRecordingToVisit(database, result.recordingSourceId, result.appointmentId);
  const snapshot = await loadCurrentRecapInput(database, result.recordingSourceId);
  const current = { ...result, binding: snapshot!.binding };
  await cacheRecapResult(database, current);
  const stale = {
    ...current,
    binding: { ...current.binding, version: current.binding.version + 1 },
  };
  await expect(cacheRecapResult(database, stale)).rejects.toThrow();
  expect(await readCurrentRecapResult(database, result.recordingSourceId)).toEqual(current);
  fixture.close();
});
