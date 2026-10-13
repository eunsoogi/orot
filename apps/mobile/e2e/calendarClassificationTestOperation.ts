import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { appleFoundationModelsNativeBridge } from '../src/providers/apple/nativeBridge';
import { classifyCalendarEvents } from '../src/medicalAppointments/classificationWorkflow';
import {
  isConfidentMedical,
  saveCalendarCandidate,
} from '../src/medicalAppointments/saveCalendarCandidate';
import { createCalendarClassificationFixtures } from './calendarClassificationFixtures';

/** The original three Calendar examples use actual Apple inference and shipping save paths. Only Calendar access and session storage are synthetic. */
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
    // Keep the original 120-second deadline for each import. A timeout is a failure, never an accepted classification.
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
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
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    availability: availability.status,
    runs,
    stored: await fixture.repository.list(),
  };
}
