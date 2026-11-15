// Synthetic native hash substitute; production uses the existing on-device CryptoKit bridge.
jest.mock('../../../agent/execution/consentFingerprint', () => ({
  fingerprintConsentSnapshot: async (text: string) =>
    require('node:crypto').createHash('sha256').update(text).digest('hex'),
}));
import { HealthObservationSchema } from '@orot/domain';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createDailyReportService } from '../dailyReportService';
import { event } from '../../../calendar/calendarTestUtils';
import { readCalendarRangeSnapshot } from '../../../calendar/calendarRangeSnapshot';
import type {
  CalendarRangeEvent,
  CalendarRangeBridge,
} from '../../../calendar/types';

export function calendarFixture() {
  let events: CalendarRangeEvent[] = [
    {
      ...event('Private clinic appointment', '2035-01-01T15:00:00Z'),
      calendarStatus: 'tentative',
    },
    {
      ...event('Private gym', '2035-01-01T16:00:00Z'),
      calendarStatus: 'canceled',
    },
  ];
  let access = true;
  const listeners = new Set<() => void>();
  const bridge: CalendarRangeBridge = {
    addEventStoreListener: listener => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    listEventsInRange: async (fromInclusive, toExclusive) => ({
      access: access ? 'fullAccess' : 'denied',
      events,
      query: {
        fromInclusive,
        toExclusive,
        resultLimit: null,
        complete: true,
        omittedEventCount: 0,
      },
    }),
  };
  return {
    bridge,
    read: (from: string, to: string, signal?: AbortSignal) =>
      readCalendarRangeSnapshot(bridge, from, to, signal),
    revoke: () => {
      access = false;
      listeners.forEach(listener => listener());
    },
    change: () => {
      events = [];
      listeners.forEach(listener => listener());
    },
    listeners,
  };
}
export function calendarReportService(
  database: Parameters<typeof createDailyReportService>[0]['database'],
  calendar: ReturnType<typeof calendarFixture>,
  authorize: ExecutionConsentPort['authorize'] = async () =>
    'authorized' as const,
) {
  const provider = new InMemoryFakeLanguageModelProvider({
    capabilities: { streaming: false },
    response: {
      text: '{"indexes":[0]}',
      toolCalls: [],
      finishReason: 'complete',
    },
  });
  const consent = jest.fn(authorize);
  const generate = jest.spyOn(provider, 'generate');
  const run = createDailyReportService({
    database,
    calendarReader: calendar.read,
    consent: { authorize: consent },
    now: () => '2035-01-01T12:00:00Z',
    createRunId: () => 'calendar-report',
    resolveSelected: async () => ({
      status: 'ready',
      provider,
      modelId: 'synthetic',
      recipient: 'synthetic recipient',
      remoteProcessing: true,
      selection: { providerId: provider.id, modelId: 'synthetic' },
      option: {
        provider,
        modelId: 'synthetic',
        displayName: 'synthetic',
        privacyBoundary: 'selected-context-remote',
        availability: { status: 'available' },
      },
    }),
  });
  return { run, provider, generate, consent };
}
export const calendarTestObservation = HealthObservationSchema.parse({
  id: 'synthetic',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
export const calendarTestRequest = () => ({
  timeZone: 'UTC',
  scope: {},
  mode: { kind: 'reuse_or_generate' as const },
  signal: new AbortController().signal,
});
