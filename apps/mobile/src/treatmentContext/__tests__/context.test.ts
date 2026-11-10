import { parseTreatmentContext } from '../validation';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';

const ref = (
  sourceKind: 'personal_record' | 'external_medical' | 'generated_artifact',
  id: string,
) => ({
  sourceKind,
  sourceId: id,
  sourceRevision: '1',
  evidenceId: id,
  evidenceRevision: '1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
});
const local = {
  reference: ref('personal_record', 'record'),
  records: [
    { kind: 'health_observation' as const, id: 'record', revision: '1' },
  ],
};
const medication = {
  reference: ref('personal_record', 'medication'),
  records: [
    { kind: 'medication_definition' as const, id: 'medication', revision: '1' },
  ],
};
const ai = {
  kind: 'generated_conversation' as const,
  reference: ref('generated_artifact', 'ai'),
  id: 'ai',
  revision: '1',
};
const publicRef = {
  ...ref('external_medical', 'europe-pmc'),
  locator: {
    originalUrl: 'https://europepmc.org/article/MED/123',
    publicationDate: '2025-01-01',
    retrievedAt: '2026-01-01T00:00:00Z',
  },
};
const publication = { reference: publicRef, records: [] };
const sources: ConversationArtifactSource[] = [
  local,
  medication,
  ai,
  publication,
];
const possibility = {
  status: 'ai_possibility' as const,
  title: 'Possible explanation',
  supportingEvidence: [local.reference],
  contraryEvidence: [medication.reference],
  uncertainty: 'Incomplete record',
  missingData: ['Timing'],
};
const publicEvidence = {
  reference: publicRef,
  originalUrl: publicRef.locator.originalUrl,
  publicationDate: '2025-01-01',
  retrievedAt: '2026-01-01T00:00:00Z',
  sourceType: null,
  population: null,
  limitations: [],
  availability: 'unknown' as const,
};
const context = {
  version: 1 as const,
  clinicianPlans: { status: 'unavailable' as const },
  conditions: [possibility],
  publicEvidence: [publicEvidence],
  missingContext: ['History'],
  conflicts: ['Different reports'],
};

test('retains uncertainty, counterevidence and unknown public source details', () => {
  expect(parseTreatmentContext(context, sources)).toEqual(context);
  expect(
    parseTreatmentContext(
      {
        ...context,
        publicEvidence: [
          { ...publicEvidence, originalUrl: 'https://example.org/' },
        ],
      },
      sources,
    ),
  ).toBeNull();
  expect(
    parseTreatmentContext(
      {
        ...context,
        publicEvidence: [{ ...publicEvidence, population: 'Adults' }],
      },
      sources,
    ),
  ).toBeNull();
  expect(
    parseTreatmentContext(
      {
        ...context,
        publicEvidence: [{ ...publicEvidence, publicationDate: '2025-02-30' }],
      },
      sources,
    ),
  ).toBeNull();
  expect(
    parseTreatmentContext(
      {
        ...context,
        publicEvidence: [{ ...publicEvidence, retrievedAt: null }],
      },
      sources,
    ),
  ).toBeNull();
});

test('medication, public literature and prior AI alone cannot support a personal possibility', () => {
  for (const reference of [medication.reference, publicRef, ai.reference]) {
    expect(
      parseTreatmentContext(
        {
          ...context,
          conditions: [
            {
              ...possibility,
              supportingEvidence: [reference],
              contraryEvidence: [],
            },
          ],
        },
        sources,
      ),
    ).toBeNull();
  }
  expect(
    parseTreatmentContext(
      {
        ...context,
        conditions: [
          {
            ...possibility,
            supportingEvidence: [local.reference, ai.reference],
          },
        ],
      },
      sources,
    ),
  ).toBeNull();
  expect(
    parseTreatmentContext(
      { ...context, conditions: [{ ...possibility, uncertainty: '' }] },
      sources,
    ),
  ).toBeNull();
  expect(
    parseTreatmentContext(
      {
        ...context,
        conditions: [{ ...possibility, contraryEvidence: [local.reference] }],
      },
      sources,
    ),
  ).toBeNull();
  expect(parseTreatmentContext(context, [])).toBeNull();
});

test('a recorded condition must name an exact retained record and revision', () => {
  const recorded = {
    status: 'clinician_recorded',
    source: local.reference,
    record: local.records[0],
    uncertainty: 'Attribution is not affirmation',
  };
  expect(
    parseTreatmentContext({ ...context, conditions: [recorded] }, sources),
  ).not.toBeNull();
  expect(
    parseTreatmentContext(
      {
        ...context,
        conditions: [
          { ...recorded, record: { ...recorded.record, revision: 'other' } },
        ],
      },
      sources,
    ),
  ).toBeNull();
});
