import {
  healthContextFixture,
  signal,
} from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { withWritePeriodCalculations } from '../writePeriodCalculationScope';
import { assertSummaryPeriodCurrent } from '../symptomSummaryPeriods';
import { registerHealthContextEvidence } from '../../aiFeatures/integration/healthContextEvidence';
import { captureConversationSources } from '../../aiFeatures/integration/captureConversationSources';
import { isConversationPhotoSource } from '../../ragConversation/conversationArtifactSources';
import type { ReadOnlyPeriodValidation } from '../readOnlyPeriodValidation';

test('same calculation still checks each revision and root generation requirement', async () => {
  const f = await healthContextFixture();
  const source = f.saved.sources.find(isPeriodSummarySource)!;
  try {
    await f.database.transaction(async tx =>
      withWritePeriodCalculations(tx, async validate => {
        await validate(tx, source, false);
        await expect(
          validate(tx, { ...source, revision: 'changed' }, false),
        ).rejects.toThrow();
        await validate(tx, { ...source, deletionGeneration: -1 }, false);
        await expect(
          validate(tx, { ...source, deletionGeneration: -1 }, true),
        ).rejects.toThrow();
      }),
    );
  } finally {
    f.close();
  }
});

test('distinct window/topic/cutoff calculations preserve strict results and invalid window errors', async () => {
  const f = await healthContextFixture();
  const original = f.saved.sources.find(isPeriodSummarySource)!;
  try {
    const sources = [original];
    for (const topic of ['activity', 'sleep'] as const) {
      const window = {
        ...original.scope.window,
        cutoff: '2026-10-06T00:00:00Z',
      };
      const item = registerHealthContextEvidence({
        registry: f.registry,
        read: f.read,
        report: await f.read(window, [topic]),
        scope: { ...original.scope, window, topic },
      });
      const captured = await captureConversationSources(
        [item],
        f.registry,
        signal,
      );
      sources.push(
        captured.sources.find(
          (source): source is typeof original =>
            !isConversationPhotoSource(source) && isPeriodSummarySource(source),
        )!,
      );
    }
    await f.database.transaction(async tx =>
      withWritePeriodCalculations(tx, async validate => {
        for (const source of sources) {
          await assertSummaryPeriodCurrent(tx, source, true);
          await validate(tx, source, true);
        }
        await expect(
          validate(
            tx,
            {
              ...original,
              scope: {
                ...original.scope,
                window: {
                  ...original.scope.window,
                  toExclusive: original.scope.window.fromInclusive,
                },
              },
            },
            true,
          ),
        ).rejects.toThrow();
      }),
    );
  } finally {
    f.close();
  }
});

test.each(['normal', 'failure'] as const)(
  'escaped validator after %s and foreign executor never reuse results',
  async mode => {
    const a = await healthContextFixture(),
      b = await healthContextFixture();
    const source = a.saved.sources.find(isPeriodSummarySource)!;
    let escaped: ReadOnlyPeriodValidation | undefined;
    try {
      const operation = a.database.transaction(async tx =>
        withWritePeriodCalculations(tx, async validate => {
          escaped = validate;
          await validate(tx, source, true);
          await b.repository.delete('health_observation', b.inside.id);
          await expect(validate(b.database, source, true)).rejects.toThrow();
          if (mode === 'failure') throw new Error('Synthetic rollback');
        }),
      );
      if (mode === 'failure')
        await expect(operation).rejects.toThrow('Synthetic rollback');
      else await operation;
      await a.repository.delete('health_observation', a.inside.id);
      await expect(escaped!(a.database, source, true)).rejects.toThrow();
    } finally {
      a.close();
      b.close();
    }
  },
);

test.each(['mutation', 'delete'] as const)(
  'generation %s between identical sources cannot reuse prior calculation',
  async mode => {
    const f = await healthContextFixture();
    const source = f.saved.sources.find(isPeriodSummarySource)!;
    try {
      await expect(
        f.database.transaction(async tx =>
          withWritePeriodCalculations(tx, async validate => {
            await validate(tx, source, true);
            await tx.execute(
              mode === 'delete'
                ? 'DELETE FROM health_observations WHERE id=?'
                : "UPDATE health_observations SET payload_json=json_set(payload_json,'$.value.amount',999) WHERE id=?",
              [f.inside.id],
            );
            await validate(tx, source, true);
          }),
        ),
      ).rejects.toThrow();
      // This helper preserves the writer's existing atomic rollback, not read-scope commit-on-error.
      expect(
        await f.repository.get('health_observation', f.inside.id),
      ).not.toBeNull();
    } finally {
      f.close();
    }
  },
);

test('final generation fence rejects changes after the last period callback', async () => {
  const f = await healthContextFixture();
  const source = f.saved.sources.find(isPeriodSummarySource)!;
  try {
    await expect(
      f.database.transaction(async tx =>
        withWritePeriodCalculations(tx, async validate => {
          await validate(tx, source, true);
          await tx.execute(
            'UPDATE health_context_generation SET mutations=mutations+1',
          );
        }),
      ),
    ).rejects.toThrow('before writing');
  } finally {
    f.close();
  }
});

test('an in-flight escaped validator revalidates strictly after its scope ends', async () => {
  const f = await healthContextFixture();
  const source = f.saved.sources.find(isPeriodSummarySource)!;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  let queries = 0;
  try {
    await f.database.transaction(async tx => {
      const execute = tx.execute.bind(tx);
      const wrapped = {
        ...tx,
        execute: async (...args: Parameters<typeof execute>) => {
          const result = await execute(...args);
          if (/WITH days\(/.test(args[0]) && ++queries === 1) {
            entered();
            await gate;
          }
          return result;
        },
      };
      let pending!: Promise<void>;
      await withWritePeriodCalculations(wrapped, async validate => {
        pending = validate(wrapped, source, true);
        await started; // Deliberately violate caller awaiting to exercise exported lifetime.
      });
      await execute('DELETE FROM health_observations WHERE id=?', [
        f.inside.id,
      ]);
      release();
      await expect(pending).rejects.toThrow();
      expect(queries).toBe(3); // Original two query parts, then strict empty-data quantity query.
    });
  } finally {
    release();
    f.close();
  }
});

test('a newer calculation cannot erase an earlier validated generation for the same key', async () => {
  const f = await healthContextFixture();
  const source = f.saved.sources.find(isPeriodSummarySource)!;
  try {
    await expect(
      f.database.transaction(async tx =>
        withWritePeriodCalculations(tx, async validate => {
          await validate(tx, source, false);
          await tx.execute(
            'UPDATE health_context_generation SET mutations=mutations+1',
          );
          await validate(tx, source, false);
        }),
      ),
    ).rejects.toThrow('between write sources');
  } finally {
    f.close();
  }
});
