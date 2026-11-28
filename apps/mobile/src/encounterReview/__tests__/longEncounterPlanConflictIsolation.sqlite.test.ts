import { providerSuccess } from '@orot/model-runtime';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { consent } from '../__fixtures__/sqliteReview';
import { fixture, harness } from '../__fixtures__/longReviewHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const unrelated = 'synthetic-malformed-unrelated-assertion';

test.each(['plan', 'medication', 'mixed', 'healthy-medication'] as const)(
  'long saved transcript preserves exact %s conflict dependencies',
  async kind => {
    const f = await harness(9);
    try {
      // This row has valid SQL JSON but cannot decode as a MedicationAssertion.
      // The actual repository still rejects reading it as a conflict source.
      const db = fixture.database();
      const at = '2026-01-01T00:00:00.000Z';
      const malformed = kind !== 'healthy-medication';
      if (malformed) {
        await db.execute(
          'INSERT INTO medication_assertions (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
          [unrelated, at, at, at, '{}'],
        );
        await expect(f.repository.list('medication_assertion')).rejects.toThrow(
          'A stored record is invalid',
        );
      }
      const resolve = jest.mocked(resolveSelectedAiProvider);
      const selected = await resolve();
      if (selected.status !== 'ready')
        throw new Error('Synthetic provider missing.');
      if (kind !== 'plan') {
        const generate = selected.provider.generate.bind(selected.provider);
        jest
          .spyOn(selected.provider, 'generate')
          .mockImplementation(async (...args) => {
            const result = await generate(...args);
            if (!result.ok) return result;
            const reply = JSON.parse(result.value.text ?? '');
            const plans = reply.value.candidates;
            const medications = plans.map((candidate: object) => ({
              ...candidate,
              kind: 'medication',
            }));
            reply.value.candidates =
              kind === 'mixed' ? [...plans, ...medications] : medications;
            return providerSuccess({
              ...result.value,
              text: JSON.stringify(reply),
            });
          });
      }
      await f.controller.start(consent);
      expect(f.calls()).toBe(2);
      expect(await fixture.rows()).toEqual([]);
      if (malformed && kind !== 'plan') {
        expect(f.controller.state.status).toBe('unavailable');
        expect(f.controller.state.pending).toBeUndefined();
        expect(f.controller.state.candidates).toEqual([]);
        await f.controller.decide('approve');
        expect(await fixture.rows()).toEqual([]);
      } else {
        expect(f.controller.state.status).toBe('pending');
        expect(f.controller.state.candidates).toEqual([
          expect.objectContaining({
            kind: kind === 'plan' ? 'plan' : 'medication',
            evidence: [expect.objectContaining({ segmentId: f.final.id })],
          }),
        ]);
        await f.controller.decide('approve');
        expect(f.controller.state.status).toBe('saved');
        expect(await fixture.rows()).toEqual([
          expect.objectContaining({
            concept:
              kind === 'plan'
                ? 'encounter_plan'
                : 'encounter_medication_statement',
            provenance: expect.objectContaining({
              sourceRecordIds: expect.arrayContaining([f.final.id]),
            }),
          }),
        ]);
      }
      expect(f.calls()).toBe(2);
      expect(
        (
          await db.execute(
            'SELECT payload_json FROM medication_assertions WHERE id = ?',
            [unrelated],
          )
        ).rows,
      ).toEqual(malformed ? [{ payload_json: '{}' }] : []);
    } finally {
      f.controller.dispose();
    }
  },
);

test.each([false, true])(
  'long local acceptance reads prior observations only when it has candidates (%s)',
  async hasCandidates => {
    const f = await harness(9);
    try {
      const db = fixture.database();
      const at = '2026-01-01T00:00:00.000Z';
      await db.execute(
        'INSERT INTO health_observations (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
        ['synthetic-unrelated-observation', at, at, at, '{}'],
      );
      await expect(f.repository.list('health_observation')).rejects.toThrow(
        'A stored record is invalid',
      );
      const selected = await resolveSelectedAiProvider();
      if (selected.status !== 'ready')
        throw new Error('Synthetic provider missing.');
      if (!hasCandidates) {
        const generate = selected.provider.generate.bind(selected.provider);
        jest
          .spyOn(selected.provider, 'generate')
          .mockImplementation(async (...args) => {
            const reply = await generate(...args);
            if (!reply.ok) return reply;
            return providerSuccess({
              ...reply.value,
              text: JSON.stringify({
                type: 'result',
                value: { candidates: [] },
                citations: [],
              }),
            });
          });
      }

      await f.controller.start(consent);
      expect(f.calls()).toBe(2);
      expect(f.controller.state.status).toBe(
        hasCandidates ? 'unavailable' : 'pending',
      );
      expect(f.controller.state.candidates).toEqual([]);
      if (!hasCandidates)
        expect(f.controller.state.pending?.segments).toHaveLength(9);
      await f.controller.decide('approve');
      expect(
        (await db.execute('SELECT id, payload_json FROM health_observations'))
          .rows,
      ).toEqual([
        { id: 'synthetic-unrelated-observation', payload_json: '{}' },
      ]);
    } finally {
      f.controller.dispose();
    }
  },
);
