import type { SqlExecutor } from '@orot/storage';
import { sharedAncestryProfileFixture } from '../../aiFeatures/integration/testSupport/sharedAncestryProfileFixture';
import type { ConversationArtifact } from '../conversationArtifactCodec';
import { assertConversationArtifactCurrent } from '../conversationArtifactFreshness';
import {
  createConversationSharedAncestry,
  type ConversationSharedAncestry,
} from '../conversationSharedAncestry';
import {
  createReadOnlyPeriodValidation,
  type ReadOnlyPeriodValidation,
} from '../readOnlyPeriodValidation';
import { isGeneratedConversationSource } from '../../ragConversation/conversationArtifactSources';

function validate(
  tx: SqlExecutor,
  database: Parameters<typeof assertConversationArtifactCurrent>[1],
  artifact: ConversationArtifact,
  token?: ConversationSharedAncestry,
  readPeriods?: ReadOnlyPeriodValidation,
) {
  return assertConversationArtifactCurrent(
    tx,
    database,
    artifact,
    false,
    readPeriods,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    token,
  );
}

test('coalesces a real shared DAG across distinct roots and preserves every original result', async () => {
  const fixture = await sharedAncestryProfileFixture(5, true);
  try {
    const roots = (await fixture.storage.readMany([
      'dag-turn-2',
      'dag-turn-3',
      'dag-turn-4',
    ])) as ConversationArtifact[];
    expect(roots.map(root => root.id)).toEqual([
      'dag-turn-2',
      'dag-turn-3',
      'dag-turn-4',
    ]);
    const controls = [];
    for (const optimize of [false, true]) {
      const sql = { parents: 0, markers: 0, total: 0 };
      await fixture.database.transaction(async tx => {
        const sameExecutor: SqlExecutor = {
          async execute(statement, args) {
            sql.total++;
            if (statement.includes('conversation_invalid_parents'))
              sql.parents++;
            if (statement.includes('linked_ids(id)')) sql.markers++;
            return tx.execute(statement, args);
          },
        };
        const token = optimize
          ? createConversationSharedAncestry(sameExecutor, () => true)
          : undefined;
        const readPeriods = createReadOnlyPeriodValidation(sameExecutor);
        for (const root of roots)
          await expect(
            validate(sameExecutor, fixture.database, root, token, readPeriods),
          ).resolves.toBeUndefined();
      });
      controls.push(sql);
    }
    expect(controls.map(control => control.parents)).toEqual([25, 4]);
    expect(controls.map(control => control.markers)).toEqual([112, 28]);
    expect(controls.map(control => control.total)).toEqual([297, 87]);
  } finally {
    fixture.close();
  }
}, 30000);

test('does not reuse a different revision, revoked owner, or foreign executor', async () => {
  const fixture = await sharedAncestryProfileFixture(3, true);
  try {
    const root = (await fixture.storage.read('dag-turn-2'))!;
    const selected = root.sources.find(isGeneratedConversationSource)!;
    await fixture.database.transaction(async tx => {
      let current = true;
      const proof = createConversationSharedAncestry(tx, () => current);
      await validate(tx, fixture.database, root, proof);
      const different = {
        ...root,
        sources: root.sources.map(source =>
          source === selected
            ? { ...source, revision: 'invalid-revision' }
            : source,
        ),
      };
      await expect(
        validate(tx, fixture.database, different, proof),
      ).rejects.toThrow('The generated conversation changed or was removed.');
      // The old read proof has no authority once the same-connection mutation crosses the gateway.
      await tx.execute('DELETE FROM conversation_artifacts WHERE id=?', [
        selected.id,
      ]);
      const foreign: SqlExecutor = {
        execute: (sql, args) => tx.execute(sql, args),
      };
      await expect(
        validate(foreign, fixture.database, root, proof),
      ).rejects.toThrow('The generated conversation changed or was removed.');
      current = false;
      await expect(validate(tx, fixture.database, root, proof)).rejects.toThrow(
        'The generated conversation changed or was removed.',
      );
    });
    expect(await fixture.storage.read(selected.id)).toBeNull();
  } finally {
    fixture.close();
  }
}, 30000);
