import { providerFailure } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { CalendarEvent } from '../../calendar/types';
import { classifyCalendarEvents } from '../classificationWorkflow';
import {
  event,
  input,
  makeProvider,
  workflowResponse,
  stringContent,
} from '../classificationWorkflowTestFixtures';

describe('bounded Calendar classification workflow', () => {
  it('sends at most eight items per runtime call, binds remote consent, and preserves every class', async () => {
    const events = Array.from({ length: 9 }, (_, index) => event(index));
    const trace: string[] = [];
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      trace.push('provider');
      return workflowResponse(request);
    });
    const authorize = jest.fn(async () => {
      trace.push('consent');
      return 'authorized' as const;
    });
    const progress: number[] = [];
    const options = input(events, {
      provider: makeProvider(generate),
      consent: { authorize },
      onProgress: value => progress.push(value.completedBatches),
    });
    jest
      .spyOn(options.bridge, 'findEvent')
      .mockImplementation(async identifier => {
        trace.push(`lookup:${identifier}`);
        return {
          access: 'fullAccess' as const,
          event:
            events.find(
              value => value.calendarEventIdentifier === identifier,
            ) ?? null,
        };
      });

    const result = await classifyCalendarEvents(options);

    expect(result.status).toBe('complete');
    expect(result.candidates).toHaveLength(9);
    expect(result.candidates[0]?.classification).toBe('medical');
    expect(result.candidates[1]?.classification).toBe('uncertain');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(2);
    const checksForBatch = (batch: readonly CalendarEvent[]) => [
      ...batch.map(value => `lookup:${value.calendarEventIdentifier}`),
      'consent',
      ...batch.map(value => `lookup:${value.calendarEventIdentifier}`),
      'provider',
      ...batch.map(value => `lookup:${value.calendarEventIdentifier}`),
      ...batch.map(value => `lookup:${value.calendarEventIdentifier}`),
    ];
    expect(trace).toEqual([
      ...checksForBatch(events.slice(0, 8)),
      ...checksForBatch(events.slice(8)),
    ]);
    expect(progress).toEqual([1, 2]);
    for (const [request] of generate.mock.calls) {
      expect(request.messages).toHaveLength(4);
      const candidates = JSON.parse(
        stringContent(request.messages[1]) ?? '',
      ).candidates;
      const format = JSON.parse(stringContent(request.messages[3]) ?? '');
      expect(
        format.responseSchema.properties.value.properties.classifications
          .maxItems,
      ).toBe(candidates.length);
      expect(candidates.length).toBeLessThanOrEqual(8);
      expect(JSON.stringify(request.messages)).not.toContain(
        'private-calendar-id',
      );
    }
  });

  it('leaves every candidate manually reviewable when remote consent is declined', async () => {
    const events = [event(0)];
    const generate = jest.fn(async (request: LanguageModelRequest) =>
      workflowResponse(request),
    );
    const result = await classifyCalendarEvents(
      input(events, {
        provider: makeProvider(generate),
        consent: {
          authorize: jest.fn(async () => 'renewal_required' as const),
        },
      }),
    );

    expect(result.status).toBe('unavailable');
    expect(result.failure?.status).toBe('consent_required');
    expect(result.candidates[0]).toMatchObject({ status: 'unclassified' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('stops after a failed batch and leaves the failed overflow unclassified', async () => {
    const events = Array.from({ length: 9 }, (_, index) => event(index));
    const generate = jest
      .fn()
      .mockImplementationOnce(async (request: LanguageModelRequest) =>
        workflowResponse(request),
      )
      .mockImplementationOnce(async () =>
        providerFailure({
          code: 'provider_unavailable',
          message: 'Provider unavailable.',
          retryable: true,
        }),
      );
    const result = await classifyCalendarEvents(
      input(events, { provider: makeProvider(generate) }),
    );

    expect(result.status).toBe('partial');
    expect(result.failure).toMatchObject({
      status: 'unavailable',
      providerErrorCode: 'provider_unavailable',
      batchNumber: 2,
    });
    expect(result.completedBatches).toBe(1);
    expect(
      result.candidates.slice(0, 8).every(item => item.status === 'classified'),
    ).toBe(true);
    expect(result.candidates[8]).toMatchObject({ status: 'unclassified' });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
