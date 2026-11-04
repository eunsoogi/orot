import type { SqlDatabase } from '@orot/storage';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

const reference = {
  sourceKind: 'generated_artifact' as const,
  sourceId: 'parent-turn',
  sourceRevision: 'pending',
  evidenceId: 'parent-turn',
  evidenceRevision: 'pending',
  locator: { kind: 'generated_artifact', type: 'conversation_turn' },
  effectiveTime: null,
  reviewState: 'unreviewed' as const,
};

/** Construct an alternating chain to exercise transitive deletion across catalogs. */
export async function createRecursiveArtifactChain(database: SqlDatabase) {
  const conversations = createConversationArtifactStorage(database);
  await conversations.createSession(
    'parent-session',
    await conversations.currentGeneration(),
  );
  const parent = {
    id: 'parent-turn',
    sessionId: 'parent-session',
    createdAt: '2026-10-05T00:00:00.000Z',
    providerId: 'provider',
    modelId: 'model',
    status: 'complete' as const,
    question: 'Question',
    answer: 'Historical generated answer',
    sources: [],
    citations: [],
  };
  await conversations.append(parent);
  const revision = fingerprint(parent);
  const parentReference = {
    ...reference,
    sourceRevision: revision,
    evidenceRevision: revision,
  };
  const summaries = createSymptomSummaryStorage(database);
  await summaries.append({
    id: 'child-summary',
    createdAt: '2026-10-05T00:01:00.000Z',
    modelName: 'Synthetic',
    modelId: 'model',
    providerId: 'provider',
    inputLineage: 'complete',
    analysis: {
      hypotheses: [
        {
          title: 'Historical output',
          summary: 'A follow-up interpretation.',
          uncertainty: 'This is generated context.',
          missingData: [],
          supportingEvidence: [parentReference],
          contraryEvidence: [],
        },
      ],
    },
    sources: [
      {
        kind: 'generated_conversation',
        reference: parentReference,
        id: parent.id,
        revision,
      },
    ],
  });

  expect(await summaries.read('child-summary')).not.toBeNull();
  const childRevision = fingerprint(await summaries.read('child-summary'));
  const firstCitation = {
    ...reference,
    sourceId: 'child-summary',
    evidenceId: 'child-summary',
    sourceRevision: childRevision,
    evidenceRevision: childRevision,
    locator: { kind: 'generated_artifact', type: 'disease_possibilities' },
  };
  await summaries.append({
    id: 'grandchild-summary',
    createdAt: '2026-10-05T00:02:00.000Z',
    modelName: 'Synthetic',
    modelId: 'model',
    providerId: 'provider',
    inputLineage: 'complete',
    analysis: {
      hypotheses: [
        {
          title: 'Follow-up',
          summary: 'Further interpretation.',
          uncertainty: 'Unknown',
          missingData: [],
          supportingEvidence: [firstCitation],
          contraryEvidence: [],
        },
      ],
    },
    sources: [
      {
        kind: 'generated_summary',
        reference: firstCitation,
        id: 'child-summary',
        revision: childRevision,
      },
    ],
  });
  const grandchildRevision = fingerprint(
    await summaries.read('grandchild-summary'),
  );
  const summaryReference = {
    ...firstCitation,
    sourceId: 'grandchild-summary',
    evidenceId: 'grandchild-summary',
    sourceRevision: grandchildRevision,
    evidenceRevision: grandchildRevision,
  };
  await conversations.createSession(
    'second-session',
    await conversations.currentGeneration(),
  );
  const secondTurn = {
    ...parent,
    id: 'second-turn',
    sessionId: 'second-session',
    sources: [
      {
        kind: 'generated_summary' as const,
        reference: summaryReference,
        id: 'grandchild-summary',
        revision: grandchildRevision,
      },
    ],
    citations: [summaryReference],
  };
  await conversations.append(secondTurn);
  const secondRevision = fingerprint(secondTurn);
  const secondReference = {
    ...reference,
    sourceId: 'second-turn',
    evidenceId: 'second-turn',
    sourceRevision: secondRevision,
    evidenceRevision: secondRevision,
  };
  await summaries.append({
    id: 'third-summary',
    createdAt: '2026-10-05T00:03:00.000Z',
    modelName: 'Synthetic',
    modelId: 'model',
    providerId: 'provider',
    inputLineage: 'complete',
    analysis: {
      hypotheses: [
        {
          title: 'Follow-up',
          summary: 'Further interpretation.',
          uncertainty: 'Unknown',
          missingData: [],
          supportingEvidence: [secondReference],
          contraryEvidence: [],
        },
      ],
    },
    sources: [
      {
        kind: 'generated_conversation',
        reference: secondReference,
        id: 'second-turn',
        revision: secondRevision,
      },
    ],
  });
  const thirdRevision = fingerprint(await summaries.read('third-summary'));
  const thirdReference = {
    ...firstCitation,
    sourceId: 'third-summary',
    evidenceId: 'third-summary',
    sourceRevision: thirdRevision,
    evidenceRevision: thirdRevision,
  };
  await conversations.createSession(
    'third-session',
    await conversations.currentGeneration(),
  );
  const thirdTurn = {
    ...parent,
    id: 'third-turn',
    sessionId: 'third-session',
    sources: [
      {
        kind: 'generated_summary' as const,
        reference: thirdReference,
        id: 'third-summary',
        revision: thirdRevision,
      },
    ],
    citations: [thirdReference],
  };
  await conversations.append(thirdTurn);
  const thirdTurnRevision = fingerprint(thirdTurn);
  const thirdTurnReference = {
    ...reference,
    sourceId: 'third-turn',
    evidenceId: 'third-turn',
    sourceRevision: thirdTurnRevision,
    evidenceRevision: thirdTurnRevision,
  };
  await summaries.append({
    id: 'fourth-summary',
    createdAt: '2026-10-05T00:04:00.000Z',
    modelName: 'Synthetic',
    modelId: 'model',
    providerId: 'provider',
    inputLineage: 'complete',
    analysis: {
      hypotheses: [
        {
          title: 'Follow-up',
          summary: 'Further interpretation.',
          uncertainty: 'Unknown',
          missingData: [],
          supportingEvidence: [thirdTurnReference],
          contraryEvidence: [],
        },
      ],
    },
    sources: [
      {
        kind: 'generated_conversation',
        reference: thirdTurnReference,
        id: 'third-turn',
        revision: thirdTurnRevision,
      },
    ],
  });
  const fourthRevision = fingerprint(await summaries.read('fourth-summary'));
  const childCitation = {
    ...firstCitation,
    sourceId: 'fourth-summary',
    evidenceId: 'fourth-summary',
    sourceRevision: fourthRevision,
    evidenceRevision: fourthRevision,
    content: 'A follow-up interpretation.',
  };
  return { conversations, summaries, childCitation };
}
