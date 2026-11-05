import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { registerHealthContextEvidence } from '../../aiFeatures/integration/healthContextEvidence';
import {
  captureFilteredToolPeriod,
  readFilteredToolPeriod,
  type FilteredToolPeriod,
} from '../conversationToolFilteredPeriod';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

test.each(['synthetic a', 'PRIVATE_UNMATCHED'])(
  'retains filtered period semantics without saving input %s',
  async filter => {
    const f = await healthContextFixture();
    try {
      await createConversationArtifactStorage(f.database).currentGeneration();
      await f.repository.put('medication_definition', {
        ...medicationDefinition('medication-1', '2026-09-01T00:00:00Z'),
        displayText: 'Synthetic A',
      });

      await f.repository.put(
        'dose_event',
        importedDoseEvent('dose-1', '2026-10-01T01:00:00Z', 'taken'),
      );
      const window = {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-03T00:00:00Z',
        timeZone: 'UTC',
        doseHistory: { medicationName: filter, page: 1, pageSize: 1 },
      };
      const scope = {
        kind: 'health_context_period' as const,
        version: 1 as const,
        topic: 'medications' as const,
        window,
      };
      const report = await f.read(window, ['medications']);
      const alias = registerHealthContextEvidence({
        registry: f.registry,
        read: f.read,
        scope,
        report,
      });
      const original = f.registry.resolve(alias)!;
      let saved!: FilteredToolPeriod;
      await f.database.transaction(async tx => {
        saved = await captureFilteredToolPeriod(tx, original, scope, report);
      });
      expect(JSON.stringify(saved)).not.toContain(filter);
      expect(saved.anchorKey).toBe(
        filter === 'synthetic a'
          ? fingerprint({ kind: 'tool-dose-anchor', id: 'dose-1' })
          : null,
      );
      let restored!: Awaited<ReturnType<typeof readFilteredToolPeriod>>;
      await f.database.transaction(async tx => {
        restored = await readFilteredToolPeriod(tx, saved, true);
      });
      expect(restored.filterRedacted).toBe(true);
      expect(restored.report.doseHistory).toEqual(report.doseHistory);
      expect(JSON.stringify(restored.scope)).not.toContain(filter);
      await f.repository.delete('dose_event', 'dose-1');
      await expect(
        f.database.transaction(async tx => {
          await readFilteredToolPeriod(tx, saved, true);
        }),
      ).rejects.toThrow();
    } finally {
      f.close();
    }
  },
);

test('a newly matching record between capture and commit fences an empty filtered result', async () => {
  const f = await healthContextFixture();
  try {
    await createConversationArtifactStorage(f.database).currentGeneration();
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-03T00:00:00Z',
      timeZone: 'UTC',
      doseHistory: {
        medicationName: 'Synthetic A',
        page: 0,
        pageSize: 1,
      },
    };
    const scope = {
      kind: 'health_context_period' as const,
      version: 1 as const,
      topic: 'medications' as const,
      window,
    };
    const report = await f.read(window, ['medications']);
    const alias = registerHealthContextEvidence({
      registry: f.registry,
      read: f.read,
      scope,
      report,
    });
    let saved!: FilteredToolPeriod;
    await f.database.transaction(async tx => {
      saved = await captureFilteredToolPeriod(
        tx,
        f.registry.resolve(alias)!,
        scope,
        report,
      );
    });
    expect(saved.anchorKey).toBeNull();
    await f.repository.put('medication_definition', {
      ...medicationDefinition('medication-1', '2026-09-01T00:00:00Z'),
      displayText: 'Synthetic A',
    });
    await f.repository.put(
      'dose_event',
      importedDoseEvent('dose-1', '2026-10-01T01:00:00Z', 'taken'),
    );
    await expect(
      f.database.transaction(async tx => {
        await readFilteredToolPeriod(tx, saved, true);
      }),
    ).rejects.toThrow('changed');
  } finally {
    f.close();
  }
});
