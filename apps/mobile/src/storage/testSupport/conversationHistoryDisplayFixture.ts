import type { SqlDatabase } from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import type { ConversationArtifact } from '../conversationArtifactCodec';

export const date = '2026-10-05T00:00:00.000Z';

export async function setup() {
  const fixture = await healthContextFixture();
  let projection = false;
  let strict: number | undefined;
  const sql: string[] = [];
  const trace = (query: string) => {
    if (strict !== undefined) strict++;
    if (!projection) return;
    sql.push(query);
    if (
      /\b(?:health_observations|source_records|symptom_summary_runs|research_artifacts|transcript_artifact_staleness)\b/i.test(
        query,
      ) ||
      /\bhealth_context_generation\b/i.test(query) ||
      (/\bWITH RECURSIVE\b/i.test(query) &&
        !query.includes('WITH RECURSIVE ownership(root, artifact_id)'))
    )
      throw new Error('Display touched source validation.');
  };
  const db = fixture.database;
  const guarded: SqlDatabase = {
    async execute(query, bindings) {
      trace(query);
      return db.execute(query, bindings);
    },
    transaction(work) {
      return db.transaction(tx =>
        work({
          ...tx,
          async execute(query, bindings) {
            trace(query);
            return tx.execute(query, bindings);
          },
        }),
      );
    },
  };
  const storage = createConversationArtifactStorage(guarded);
  const generation = await storage.currentGeneration();
  await storage.createSession('selected', generation);
  await storage.createSession('foreign', generation);
  const revision = fingerprint(fixture.inside);
  const personal = {
    reference: {
      sourceKind: 'personal_record' as const,
      sourceId: fixture.inside.id,
      evidenceId: fixture.inside.id,
      sourceRevision: revision,
      evidenceRevision: revision,
      reviewState: 'unreviewed' as const,
      locator: null,
      effectiveTime: null,
    },
    records: [
      { kind: 'health_observation' as const, id: fixture.inside.id, revision },
    ],
  };
  const external = {
    reference: {
      ...personal.reference,
      sourceKind: 'external_medical' as const,
      sourceId: 'public',
      evidenceId: 'public',
      sourceRevision: 'synthetic-public',
      evidenceRevision: 'synthetic-public',
    },
    records: [],
  };
  async function save(
    id: string,
    fields: Partial<ConversationArtifact> = {},
    commit = true,
  ) {
    const value: ConversationArtifact = {
      id,
      sessionId: 'selected',
      createdAt: date,
      question: 'Synthetic question',
      answer: 'Previously committed synthetic answer',
      providerId: 'synthetic-provider',
      modelId: 'synthetic-model',
      status: 'complete',
      sources: [],
      citations: [],
      ...fields,
    };
    if (commit)
      await storage.startRequest({
        id,
        sessionId: value.sessionId,
        sessionVersion: 0,
        question: value.question,
        createdAt: value.createdAt,
      });
    await storage.append(value);
    return value;
  }
  return {
    ...fixture,
    summaryStorage: fixture.storage,
    db,
    storage,
    personal,
    external,
    save,
    sql,
    async strictCount(ids: readonly string[]) {
      strict = 0;
      try {
        await storage.readManyWithAncestry(ids);
        return strict;
      } finally {
        strict = undefined;
      }
    },
    display: async (ids: readonly string[], version = 0) => {
      projection = true;
      try {
        return await storage.readSessionPresentationMany(
          'selected',
          version,
          ids,
        );
      } finally {
        projection = false;
      }
    },
  };
}
