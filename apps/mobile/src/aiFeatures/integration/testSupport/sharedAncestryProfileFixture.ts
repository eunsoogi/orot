import { fingerprint } from '../evidenceUtils';
import type { ConversationArtifact } from '../../../storage/conversationArtifactCodec';
import { diverseHistoryProfileFixture } from './diverseHistoryProfileFixture';

/** Synthetic DAG with authoritative stored parents, not forged source validity. */
export async function sharedAncestryProfileFixture(
  count: number,
  dag: boolean,
) {
  const f = await diverseHistoryProfileFixture(count, !dag);
  if (dag) {
    const templates = await f.storage.readMany(
      Array.from({ length: count }, (_, i) => `turn-${i}`),
    );
    const parents: ConversationArtifact[] = [];
    for (const template of templates) {
      if (!template) throw new Error('Missing synthetic template');
      const inherited = parents.map(parent => {
        const revision = fingerprint(parent);
        return {
          kind: 'generated_conversation' as const,
          id: parent.id,
          revision,
          reference: {
            ...template.citations![0]!,
            sourceId: parent.id,
            evidenceId: parent.id,
            sourceRevision: revision,
            evidenceRevision: revision,
            locator: { kind: 'generated_artifact', type: 'conversation_turn' },
          },
        };
      });
      const row = {
        ...template,
        id: `dag-${template.id}`,
        sources: [...template.sources, ...inherited],
        citations: [
          ...template.citations!,
          ...inherited.map(value => value.reference),
        ],
      };
      await f.storage.append(row);
      parents.push(row);
    }
  }
  return f;
}
