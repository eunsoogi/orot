import { bindRecordingToVisit, loadCurrentRecapInput } from '../src';
import { setupAutomatic } from './visitQuestionAutomaticSupport';
import { extractionFixture } from '../../agent-runtime/__tests__/recap-fixtures';
import { createAutomaticRecapService } from '../../../apps/mobile/src/transcription/automaticRecapService';

jest.mock('../../../apps/mobile/src/aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));

it('runs the new visit after rebinding while the old provider is held', async () => {
  const fixture = await setupAutomatic();
  try {
    const source = fixture.result.recordingSourceId;
    const visitA = fixture.result.appointmentId;
    const visitB = 'another-visit';
    const questionA = (await fixture.records.get(
      'visit_question',
      fixture.result.questions[0].questionId,
    ))!;
    const appointmentA = (await fixture.records.get('appointment', visitA))!;
    await fixture.records.put('appointment', { ...appointmentA, id: visitB });
    await fixture.records.put('visit_question', {
      ...questionA,
      id: 'another-question',
      appointmentId: visitB,
    });
    await bindRecordingToVisit(fixture.database, source, visitA);
    const inputA = (await loadCurrentRecapInput(fixture.database, source))!;
    const providerA = extractionFixture(inputA);
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = providerA.generate.getMockImplementation()!;
    providerA.generate.mockImplementationOnce(async (request) => {
      started();
      await gate;
      return original(request);
    });
    const {
      resolveSelectedAiProvider,
    } = require('../../../apps/mobile/src/aiFeatures/integration/provider');
    resolveSelectedAiProvider.mockResolvedValueOnce({
      status: 'ready',
      provider: providerA.options.provider,
      modelId: 'a',
      recipient: 'synthetic',
      remoteProcessing: false,
    });
    const run = createAutomaticRecapService(fixture.database, providerA.consent);
    const signal = new AbortController().signal;
    const first = run(source, inputA.segments, signal);
    await entered;
    await bindRecordingToVisit(fixture.database, source, visitB);
    const inputB = (await loadCurrentRecapInput(fixture.database, source))!;
    const providerB = extractionFixture(inputB);
    resolveSelectedAiProvider.mockResolvedValueOnce({
      status: 'ready',
      provider: providerB.options.provider,
      modelId: 'b',
      recipient: 'synthetic',
      remoteProcessing: false,
    });
    const second = run(source, inputB.segments, signal);
    expect(await second).toEqual({ status: 'saved' });
    release();
    expect(await first).toEqual({ status: 'stale_source' });
    expect(await fixture.official.listForAppointment(visitA)).toHaveLength(0);
    expect(await fixture.official.listForAppointment(visitB)).toHaveLength(1);
  } finally {
    fixture.close();
  }
});
