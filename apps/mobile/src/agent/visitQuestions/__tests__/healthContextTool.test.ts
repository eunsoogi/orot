import type { EvidenceSearchRequest } from '@orot/agent-runtime';
import { createVisitHealthContext } from '../healthContext';
import { visitHealthFixture } from '../testing/healthContextFixture';
import { visitQuestionCitationKey } from '../evidence';

test('reads bounded period facts only after selection and preserves scope, cancellation and metadata', async () => {
  jest.useFakeTimers({ now: Date.parse('2026-10-05T12:00:00Z') });
  const f = await visitHealthFixture();
  try {
    const read = jest.fn(f.read);
    const metadata = new Map();
    const context = createVisitHealthContext(read, metadata);
    const request: EvidenceSearchRequest = {
      operationRunId: 'synthetic-visit',
      operationKey: 'period-call',
      input: { topics: ['measurements', 'sleep'], detail: 'weekly' },
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 1,
      maxPayloadBytes: 32768,
      signal: new AbortController().signal,
    };
    expect(read).not.toHaveBeenCalled();
    const restricted = await context.tool.search({
      ...request,
      allowedScope: {
        sourceKinds: ['personal_record'],
        sourceIds: ['one-source'],
      },
    });
    if ('status' in restricted) throw new Error('Expected bounded coverage.');
    expect(restricted.items).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
    const batch = await context.tool.search(request);
    if ('status' in batch) throw new Error('Expected bounded period evidence.');
    expect(batch.items).toHaveLength(1);
    expect(batch.coverage[0]?.gaps).toContain('topic_result_limit_reached');
    const item = batch.items[0]!;
    expect(item.content).toContain('meanOfRecordedDailyMeans');
    expect(item.content).toContain('weeks');
    expect(JSON.stringify(batch)).not.toContain(f.observation.id);
    const saved = metadata.get(
      visitQuestionCitationKey(item),
    )?.healthContextSource;
    expect(saved.scope.topic).toBe('measurements');
    expect(await context.validate(saved)).toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    read.mockClear();
    await expect(
      context.tool.search({ ...request, signal: aborted.signal }),
    ).rejects.toThrow('cancelled');
    expect(read).not.toHaveBeenCalled();
  } finally {
    f.close();
    jest.useRealTimers();
  }
});
