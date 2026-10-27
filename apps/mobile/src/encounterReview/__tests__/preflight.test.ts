import {
  sqliteEncounterFixture,
  sourceId,
} from '../../agent/encounter/__fixtures__/sqliteFixture';
import { openLocalStorage } from '../../storage/secureDatabase';
import { createEncounterReviewService } from '../service';

jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
const fixture = sqliteEncounterFixture();
beforeEach(() => {
  jest.mocked(openLocalStorage).mockResolvedValue(fixture.repository());
});
const consent = { authorize: jest.fn(async () => 'authorized' as const) };

test('missing selected model fails without substituting a provider or writing records', async () => {
  for (const status of ['selection-required', 'unavailable'] as const) {
    const resolve = jest.fn(async () => ({ status }));
    const service = createEncounterReviewService(resolve);
    expect(
      await service.start(sourceId, consent, new AbortController().signal),
    ).toEqual({ status });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(await fixture.repository().list('health_observation')).toHaveLength(
      0,
    );
  }
  expect(consent.authorize).not.toHaveBeenCalled();
});

test('a recording without transcript cannot begin extraction or resolve a model', async () => {
  const source = await fixture.repository().get('source_record', sourceId);
  if (!source) throw new Error('Fixture source missing.');
  const emptySourceId = sourceId + ':empty';
  await fixture
    .repository()
    .put('source_record', { ...source, id: emptySourceId });
  const resolve = jest.fn(async () => ({
    status: 'selection-required' as const,
  }));
  const service = createEncounterReviewService(resolve);
  expect(
    await service.start(emptySourceId, consent, new AbortController().signal),
  ).toEqual({ status: 'no-transcript' });
  expect(resolve).not.toHaveBeenCalled();
  expect(await fixture.repository().list('health_observation')).toHaveLength(0);
});
