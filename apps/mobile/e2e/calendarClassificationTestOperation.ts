import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { appleFoundationModelsProbeBridge as appleFoundationModelsNativeBridge } from './appleModelMockBridge';
import { classifyCalendarEvents } from '../src/medicalAppointments/classificationWorkflow';
import {
  isConfidentMedical,
  saveCalendarCandidate,
} from '../src/medicalAppointments/saveCalendarCandidate';
import { createCalendarClassificationFixtures } from './calendarClassificationFixtures';

/** The original three Calendar examples use the native Apple bridge and shipping save paths. Only Calendar access and session storage are synthetic. */
export async function runCalendarClassificationTestOperation() {
  const provider = new AppleFoundationModelsProvider(
    appleFoundationModelsNativeBridge,
  );
  const availability = await provider.getAvailability();
  if (availability.status !== 'available') {
    return { availability: availability.status, runs: [], stored: [] };
  }
  const fixture = createCalendarClassificationFixtures();
  const runs = [];
  for (let importNumber = 1; importNumber <= 2; importNumber += 1) {
    const controller = new AbortController();
    // The shipping classifier owns its budgets; this test adds no elapsed-time abort.
    const classification = await classifyCalendarEvents({
      provider,
      modelId: 'apple-foundation-models-system-default',
      recipient: 'on-device',
      remoteProcessing: false,
      consent: { authorize: async () => 'authorized' },
      bridge: fixture.bridge,
      events: fixture.events,
      signal: controller.signal,
    });
    const medical = classification.candidates.filter(isConfidentMedical);
    const saves = [];
    for (const candidate of medical) {
      saves.push(
        await saveCalendarCandidate(
          candidate,
          fixture.repository,
          fixture.bridge,
          controller.signal,
        ),
      );
    }
    runs.push({
      importNumber,
      classification,
      saves,
      stored: await fixture.repository.list(),
    });
    // Stop after the first unsafe outcome; there is no hidden retry of a failed classification.
    if (
      controller.signal.aborted ||
      classification.status !== 'complete' ||
      medical.length !== 1 ||
      medical[0]?.candidateId !== 'calendar-candidate-1' ||
      saves.some(result => result !== 'saved')
    )
      break;
  }
  return {
    availability: availability.status,
    runs,
    stored: await fixture.repository.list(),
  };
}
