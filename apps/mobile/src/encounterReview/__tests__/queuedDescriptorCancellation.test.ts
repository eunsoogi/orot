import type { SqlDatabase } from '@orot/storage';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { sqliteReviewFixture, sourceId } from '../__fixtures__/sqliteReview';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const fixture = sqliteReviewFixture();
type Boundary = 'queued' | 'bound' | 'live';

function holdDescriptor(database: SqlDatabase, boundary: Boundary) {
  let arrive!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => {
    arrive = resolve;
  });
  const waiting = new Promise<void>(resolve => {
    release = resolve;
  });
  let installed = false;
  let descriptorWrites = 0;
  const held: SqlDatabase = {
    ...database,
    async transaction(operation) {
      const descriptorTransaction = installed;
      if (descriptorTransaction) installed = false;
      if (descriptorTransaction && boundary === 'queued') {
        arrive();
        await waiting;
      }
      await database.transaction(async sql => {
        await operation({
          ...sql,
          async execute(query, values) {
            const result = await sql.execute(query, values);
            if (
              query.includes(
                'CREATE TRIGGER IF NOT EXISTS source_records_delete_linked_checkpoints',
              )
            )
              installed = true;
            if (
              descriptorTransaction &&
              query.includes('INSERT INTO langgraph_checkpoints') &&
              values?.[2] === 'session'
            )
              descriptorWrites++;
            if (
              descriptorTransaction &&
              boundary === 'bound' &&
              query.startsWith(
                'SELECT source_record_id FROM langgraph_checkpoint_sources',
              )
            ) {
              arrive();
              await waiting;
            }
            return result;
          },
        });
      });
    },
  };
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValueOnce(held);
  return { started, release, writes: () => descriptorWrites };
}

test.each([
  ['queued', false],
  ['bound', false],
  ['queued', true],
  ['live', false],
] as const)(
  'fences stopped descriptor work before SQL (%s; newer owner: %s)',
  async (boundary, newerOwner) => {
    const original = fixture.controllerFor();
    const consent = {
      authorize: jest.fn(async () => 'renewal_required' as const),
    };
    const previous = await original.service.start(
      sourceId,
      consent,
      new AbortController().signal,
    );
    expect(previous.status).toBe('pending');
    if (previous.status !== 'pending') throw new Error('Missing prior review.');

    const { service, synthetic } = fixture.controllerFor();
    const attempt = new AbortController();
    const held = holdDescriptor(fixture.database(), boundary);
    const result = service.start(sourceId, consent, attempt.signal);
    let expected = previous;
    if (boundary !== 'live') {
      try {
        await held.started;
        attempt.abort();
        if (newerOwner) {
          const newer = fixture.controllerFor();
          const replacement = await newer.service.start(
            sourceId,
            consent,
            new AbortController().signal,
          );
          if (replacement.status !== 'pending')
            throw new Error('Missing replacement.');
          expect(newer.synthetic.calls()).toBe(1);
          expect(replacement.pending.threadId).not.toBe(
            previous.pending.threadId,
          );
          expected = replacement;
        }
      } finally {
        held.release();
      }
    }
    const observed = await result;
    if (boundary === 'live') {
      if (observed.status !== 'pending')
        throw new Error('Missing admitted review.');
      expect(observed.pending.threadId).not.toBe(previous.pending.threadId);
      expected = observed;
    } else {
      expect(observed).toEqual({ status: 'cancelled' });
    }
    expect(held.writes()).toBe(boundary === 'live' ? 1 : 0);
    expect(synthetic.calls()).toBe(boundary === 'live' ? 1 : 0);
    expect(
      await service.restore(sourceId, new AbortController().signal),
    ).toEqual(expected);
    expect(consent.authorize).not.toHaveBeenCalled();
    expect(await fixture.rows()).toHaveLength(0);
  },
);
