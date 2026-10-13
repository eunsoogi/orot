import type { LanguageModelProvider } from '@orot/model-runtime';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { appleFoundationModelsNativeBridge } from '../src/providers/apple/nativeBridge';
import { classifyCalendarEvents } from '../src/medicalAppointments/classificationWorkflow';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';
import { runVisitQuestionWorkflow } from '../src/agent/visitQuestions/workflow';
import type { VisitQuestionContextResult } from '../src/agent/visitQuestions/evidenceService';
import type { VisitQuestionEvidenceItem } from '../src/agent/visitQuestions/taskContract';
import { visitQuestionCitationKey } from '../src/agent/visitQuestions/evidence';

const event: CalendarEvent = {
  calendarEventIdentifier: 'synthetic-appointment',
  effectiveAt: '2035-06-02T09:00:00.000Z',
  endsAt: '2035-06-02T10:00:00.000Z',
  calendarEventSnapshot: {
    title: '합성 내과 진료 예약: 최근 수면 변화 상담',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: null,
    isDetached: false,
    recurrenceRules: [],
  },
};
const evidence: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-sleep',
  sourceRevision: '1',
  evidenceId: 'synthetic-sleep-span',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'synthetic-sleep' },
  effectiveTime: '2035-06-01T09:00:00.000Z',
  reviewState: 'reviewed',
  content:
    '합성 사용자 기록: 최근 일주일간 평소보다 두 시간 일찍 잠에서 깨어 다시 잠들기 어려웠다. 다음 내과 진료에서 수면 변화와 기록할 내용을 확인하고 싶다.',
};

/** Synthetic storage boundaries isolate this real-provider probe from personal records. */
function preparedContext(): Extract<
  VisitQuestionContextResult,
  { status: 'ready' }
> {
  const collection = {
    batch: {
      items: [evidence],
      coverage: [
        {
          sourceKind: evidence.sourceKind,
          searchedSourceIds: [evidence.sourceId],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
    metadataByCitation: new Map([
      [
        visitQuestionCitationKey(evidence),
        {
          sourceRecordIds: [evidence.sourceId],
          sourceRecordRevisions: [],
          sourceDates: [],
        },
      ],
    ]),
    memoryStatus: 'available' as const,
  };
  return {
    status: 'ready',
    appointment: {
      ...event,
      id: 'synthetic-appointment',
      recordedAt: '2035-06-01T09:00:00.000Z',
      ingestedAt: '2035-06-01T09:00:00.000Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      status: 'scheduled',
    },
    appointmentRevision: 'synthetic-1',
    appointmentContext: {
      effectiveAt: event.effectiveAt,
      timeZoneIdentifier: 'Asia/Seoul',
      title: event.calendarEventSnapshot.title,
      reason: '수면 변화 상담',
    },
    query: '최근 수면 변화',
    evidence: collection,
    searchEvidence: async () => collection,
    revalidateEvidence: async references =>
      references.every(
        reference =>
          visitQuestionCitationKey(reference) ===
          visitQuestionCitationKey(evidence),
      ),
  };
}

/** Calls shipping workflows and records native failures without substituting output. */
export async function runAppleWorkflowProbe(progress: (phase: string) => void) {
  let onGenerate: (() => void) | undefined;
  const native = new AppleFoundationModelsProvider({
    ...appleFoundationModelsNativeBridge,
    generate(request, requestId) {
      const pending = appleFoundationModelsNativeBridge.generate(
        request,
        requestId,
      );
      onGenerate?.();
      return pending;
    },
  });
  const availability = await native.getAvailability();
  progress('availability=' + availability.status);
  const diagnostics: unknown[] = [];
  if (availability.status !== 'available') {
    return {
      availability: availability.status,
      calendar: 'not-run',
      nextVisit: 'not-run',
      cancellation: 'not-run',
      diagnostics,
    };
  }
  let phase = 'calendar';
  const provider: LanguageModelProvider = {
    kind: native.kind,
    id: native.id,
    displayName: native.displayName,
    capabilities: native.capabilities,
    async generate(request, options) {
      const requestPhase = phase;
      const pending = native.generate(request, options);
      const result = await pending;
      // All requests contain only synthetic fixtures, so exact diagnostics can be retained.
      diagnostics.push({ phase: requestPhase, result });
      console.log(
        'APPLE_WORKFLOW_PROVIDER ' +
          JSON.stringify({ phase: requestPhase, result }),
      );
      return result;
    },
  };
  const bridge: CalendarBridge = {
    requestAccessAndListUpcomingEvents: async () => ({
      access: 'fullAccess',
      events: [event],
    }),
    findEvent: async identifier => ({
      access: 'fullAccess',
      event: identifier === event.calendarEventIdentifier ? event : null,
    }),
    addEventStoreListener: () => ({ remove() {} }),
  };
  const runCalendar = (signal: AbortSignal) =>
    classifyCalendarEvents({
      provider,
      modelId: 'apple-foundation-models-system-default',
      recipient: 'on-device',
      remoteProcessing: false,
      consent: { authorize: async () => 'authorized' },
      bridge,
      events: [event],
      signal,
    });
  progress(phase);
  const calendar = await bounded(runCalendar);
  phase = 'nextVisit';
  progress(phase);
  const modelId = 'apple-foundation-models-system-default';
  const runNextVisit = (signal: AbortSignal) =>
    runVisitQuestionWorkflow({
      prepared: preparedContext(),
      selection: { providerId: provider.id, modelId },
      providerOptions: [
        {
          provider,
          modelId,
          displayName: 'Apple Intelligence',
          privacyBoundary: 'on-device',
          availability: { status: 'available' },
        },
      ],
      signal,
    });
  const nextVisit = await bounded(runNextVisit);
  phase = 'cancellation';
  progress(phase);
  const controller = new AbortController();
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onGenerate = () => {
    started = true;
    timer = setTimeout(() => controller.abort(), 50);
  };
  const cancelled = await bounded(signal => {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    // Exercise cancellation through the same next-visit workflow used by its UI.
    return runNextVisit(controller.signal);
  });
  if (timer) clearTimeout(timer);
  return {
    availability: availability.status,
    calendar,
    nextVisit,
    cancellation: {
      providerStarted: started,
      abortSent: controller.signal.aborted,
      result: cancelled,
      inferenceStop: 'unverified',
    },
    diagnostics,
  };
}

/** A 90-second per-workflow deadline aborts work and reports timeout as a failure. */
async function bounded<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T | { status: 'probe-error'; message: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Probe deadline exceeded: 90000 ms'));
        }, 90_000);
      }),
    ]);
  } catch (error) {
    return {
      status: 'probe-error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
