import { extractTranscriptRecap } from '@orot/agent-runtime';
import { extractionFixture } from '../../agent-runtime/__tests__/recap-fixtures';
import { bindRecordingToVisit, loadCurrentRecapInput } from '../src';
import { setupAutomatic } from './visitQuestionAutomaticSupport';

it('does not save invalid model output or invoke a provider without questions', async () => {
  const fixture = await setupAutomatic();
  try {
    const sourceId = fixture.result.recordingSourceId;
    await bindRecordingToVisit(fixture.database, sourceId, fixture.result.appointmentId);
    const input = (await loadCurrentRecapInput(fixture.database, sourceId))!;
    const invalid = extractionFixture(input, { malformed: true });
    expect((await extractTranscriptRecap(invalid.options)).status).toBe('invalid_output');
    const noQuestions = extractionFixture({ ...input, questions: [] }, {});
    expect((await extractTranscriptRecap(noQuestions.options)).status).toBe('no_questions');
    expect(noQuestions.generate).not.toHaveBeenCalled();
    expect(
      (await fixture.database.execute('SELECT recording_id FROM recap_results')).rows,
    ).toHaveLength(0);
    expect(await fixture.official.listForAppointment(input.appointmentId)).toHaveLength(0);
  } finally {
    fixture.close();
  }
});
