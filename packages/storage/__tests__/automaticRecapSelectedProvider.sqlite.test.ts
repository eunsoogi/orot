import { bindRecordingToVisit, loadCurrentRecapInput } from '../src';
import { createAutomaticRecapSyntheticProvider } from '../../../apps/mobile/e2e/transcription/automaticRecapSyntheticProvider';
import { createAutomaticRecapService } from '../../../apps/mobile/src/transcription/automaticRecapService';
import { setupAutomatic } from './visitQuestionAutomaticSupport';

it('runs the supplied selected provider through validated automatic persistence', async () => {
  const fixture = await setupAutomatic();
  try {
    const source = fixture.result.recordingSourceId;
    await bindRecordingToVisit(fixture.database, source, fixture.result.appointmentId);
    const input = (await loadCurrentRecapInput(fixture.database, source))!;
    const scripted = createAutomaticRecapSyntheticProvider(input);
    const provider = scripted.provider;
    const selection = { providerId: provider.id, modelId: 'selected-model' };
    const run = createAutomaticRecapService(
      fixture.database,
      { authorize: async () => 'authorized' },
      async () => ({
        status: 'ready',
        provider,
        modelId: selection.modelId,
        selection,
        option: {
          provider,
          modelId: selection.modelId,
          displayName: provider.displayName,
          privacyBoundary: 'on-device',
          availability: { status: 'available' },
        },
        recipient: 'synthetic',
        remoteProcessing: false,
      }),
    );
    expect(await run(source, input.segments, new AbortController().signal)).toEqual({
      status: 'saved',
    });
    expect(scripted.calls()).toBe(1);
    expect(await fixture.official.listForAppointment(input.appointmentId)).toHaveLength(1);
    expect((await fixture.database.execute('SELECT saved FROM recap_results')).rows[0].saved).toBe(
      1,
    );
  } finally {
    fixture.close();
  }
});
