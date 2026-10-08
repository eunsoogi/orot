'use strict';

const { DEFAULT_MULTI_AGENT_BUDGET } = require('@orot/agent-runtime');

function referenceMapForEvidence(testCase, aliases) {
  return new Map(
    testCase.evidence.map((item) => {
      const alias = aliases.aliasOf(item);
      if (!alias) throw new Error('Synthetic fixture evidence alias is missing.');
      return [
        item.evidenceId,
        {
          sourceKind: alias.sourceKind,
          sourceId: alias.sourceId,
          sourceRevision: alias.sourceRevision,
          evidenceId: alias.evidenceId,
          evidenceRevision: alias.evidenceRevision,
          locator: alias.locator,
          effectiveTime: alias.effectiveTime,
          reviewState: alias.reviewState,
        },
      ];
    }),
  );
}

/** Builds the app's ready-context boundary from generated records and a bounded local search result. */
function makePreparedContext(testCase) {
  const evidence = testCase.evidence.map((item) => ({ ...item }));
  const supplementalEvidence =
    testCase.expected.resultMode === 'suggestions'
      ? evidence.filter((item) => item.evidenceId.endsWith(':evidence-sleep-minutes'))
      : [];
  const initialEvidence = evidence.filter((item) => !supplementalEvidence.includes(item));
  const searchLimit = Math.max(
    0,
    DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems - initialEvidence.length,
  );
  const byIdentity = new Set(
    evidence.map((item) =>
      [
        item.sourceKind,
        item.sourceId,
        item.sourceRevision,
        item.evidenceId,
        item.evidenceRevision,
      ].join('\u0000'),
    ),
  );
  const personal = initialEvidence.filter((item) => item.sourceKind === 'personal_record');
  const memories = initialEvidence.filter((item) => item.sourceKind === 'reviewed_memory');
  const coverage = [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: [...new Set(personal.map((item) => item.sourceId))],
      gaps: [...testCase.coverageGaps],
      truncated: false,
      resultLimit: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
      returnedCount: personal.length,
    },
    {
      sourceKind: 'reviewed_memory',
      searchedSourceIds: [...new Set(memories.map((item) => item.sourceId))],
      gaps: [],
      truncated: false,
      resultLimit: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
      returnedCount: memories.length,
    },
  ];
  const searchBatch = (maxEvidenceItems, sourceKind) => {
    const items = supplementalEvidence
      .filter((item) => item.sourceKind === sourceKind)
      .slice(0, maxEvidenceItems);
    return {
      items,
      coverage: [
        {
          sourceKind,
          searchedSourceIds: [...new Set(items.map((item) => item.sourceId))],
          gaps: [],
          truncated: false,
          resultLimit: maxEvidenceItems,
          returnedCount: items.length,
        },
      ],
      conflicts: [],
    };
  };
  const prepared = {
    status: 'ready',
    appointment: testCase.appointment,
    appointmentRevision: 'synthetic-appointment-revision-v1',
    appointmentContext: testCase.appointmentContext,
    query: testCase.query,
    evidence: {
      batch: { items: initialEvidence, coverage, conflicts: [...testCase.conflicts] },
      metadataByCitation: new Map(),
      memoryStatus: memories.length ? 'available' : 'no_matching_current_memory',
    },
    searchEvidence: async (_query, maxEvidenceItems, sourceKind) => ({
      batch: searchBatch(maxEvidenceItems, sourceKind),
      metadataByCitation: new Map(),
      memoryStatus: memories.length ? 'available' : 'no_matching_current_memory',
    }),
    revalidateEvidence: async (references) =>
      references.every((item) =>
        byIdentity.has(
          [
            item.sourceKind,
            item.sourceId,
            item.sourceRevision,
            item.evidenceId,
            item.evidenceRevision,
          ].join('\u0000'),
        ),
      ),
  };

  return {
    prepared,
    supplementalBatch: searchBatch(searchLimit, 'personal_record'),
  };
}

module.exports = { makePreparedContext, referenceMapForEvidence };
