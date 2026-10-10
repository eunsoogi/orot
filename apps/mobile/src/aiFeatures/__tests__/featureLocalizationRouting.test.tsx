jest.mock('../../i18n', () => ({
  t: jest.fn((key: string, values?: Record<string, string | number>) =>
    values
      ? `translated:${key}:${Object.values(values).join(':')}`
      : `translated:${key}`,
  ),
}));

import { render } from '@testing-library/react-native';
import { t } from '../../i18n';
import { navigationText } from '../../i18n/navigation';
import { FeatureEntryScreen } from '../FeatureEntryScreen';
import { DiseaseHypothesesScreen } from '../../diseaseHypotheses/DiseaseHypothesesScreen';
import { getDiseaseHypothesisCopy } from '../../diseaseHypotheses/copy';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { getRagConversationCopy } from '../../ragConversation/copy';
import { ExternalMedicalEvidenceScreen } from '../../externalMedicalEvidence/ExternalMedicalEvidenceScreen';
import { getExternalMedicalEvidenceCopy } from '../../externalMedicalEvidence/copy';

const translated = jest.mocked(t);

const featureScreens = [
  {
    name: 'feature entry',
    expectBackButton: false,
    element: (
      <FeatureEntryScreen
        onOpenVisitQuestions={jest.fn()}
        onOpenDiseaseHypotheses={jest.fn()}
        onOpenRagConversation={jest.fn()}
        onOpenExternalEvidence={jest.fn()}
      />
    ),
    expectedKeys: [
      'aiFeatures.heading',
      'aiFeatures.subtitle',
      'aiFeatures.disclaimer',
      'aiFeatures.visitQuestions.title',
      'aiFeatures.visitQuestions.description',
      'aiFeatures.visitQuestions.action',
      'aiFeatures.visitQuestions.unavailable',
      'aiFeatures.diseaseHypotheses.title',
      'aiFeatures.diseaseHypotheses.description',
      'aiFeatures.diseaseHypotheses.action',
      'aiFeatures.ragConversation.title',
      'aiFeatures.ragConversation.description',
      'aiFeatures.ragConversation.action',
      'aiFeatures.externalEvidence.title',
      'aiFeatures.externalEvidence.description',
      'aiFeatures.externalEvidence.action',
    ],
  },
  {
    name: 'disease hypotheses',
    expectBackButton: true,
    element: (
      <DiseaseHypothesesScreen
        onBack={jest.fn()}
        onGenerate={async () => ({
          status: 'incomplete_inventory',
          reason: 'incomplete',
        })}
        onOpenSource={jest.fn()}
      />
    ),
    expectedKeys: [
      'diseaseHypotheses.title',
      'diseaseHypotheses.explanation',
      'diseaseHypotheses.generate',
      'diseaseHypotheses.loading',
      'diseaseHypotheses.insufficient',
      'diseaseHypotheses.error',
      'diseaseHypotheses.uncertainty',
      'diseaseHypotheses.missingData',
      'diseaseHypotheses.supporting',
      'diseaseHypotheses.contrary',
      'diseaseHypotheses.noContrary',
      'diseaseHypotheses.retry',
      'diseaseHypotheses.noAdditionalInfo',
    ],
  },
  {
    name: 'RAG conversation',
    expectBackButton: true,
    element: (
      <ConversationScreen
        onBack={jest.fn()}
        onSend={async () => ({ status: 'no_evidence' })}
        onOpenSource={jest.fn()}
      />
    ),
    expectedKeys: [
      'ragConversation.title',
      'ragConversation.description',
      'ragConversation.placeholder',
      'ragConversation.send',
      'ragConversation.loading',
      'ragConversation.noEvidence',
      'ragConversation.insufficient',
      'ragConversation.unavailable',
      'ragConversation.speakerUser',
    ],
  },
  {
    name: 'external medical evidence',
    expectBackButton: true,
    element: (
      <ExternalMedicalEvidenceScreen
        onBack={jest.fn()}
        service={{ search: async () => ({ status: 'empty' }) }}
        onOpenArticle={jest.fn()}
      />
    ),
    expectedKeys: [
      'externalMedicalEvidence.title',
      'externalMedicalEvidence.description',
      'externalMedicalEvidence.placeholder',
      'externalMedicalEvidence.search',
      'externalMedicalEvidence.loading',
      'externalMedicalEvidence.consent',
      'externalMedicalEvidence.consentRequired',
      'externalMedicalEvidence.empty',
      'externalMedicalEvidence.unavailable',
      'externalMedicalEvidence.unknownDate',
      'externalMedicalEvidence.open',
      'externalMedicalEvidence.authorUnknown',
    ],
  },
];

test.each(featureScreens)(
  '$name routes every owned label through t()',
  async ({ element, expectedKeys, expectBackButton }) => {
    translated.mockClear();
    const { getByRole, queryByRole } = await render(element);

    if (expectBackButton) {
      expect(
        getByRole('button', { name: navigationText.back.accessibilityLabel }),
      ).toBeTruthy();
    } else {
      expect(
        queryByRole('button', { name: navigationText.back.accessibilityLabel }),
      ).toBeNull();
    }

    // Enumerating each catalog prevents new app-owned literals from bypassing t().
    expect(
      [...new Set(translated.mock.calls.map(([key]) => key))].sort(),
    ).toEqual([...expectedKeys].sort());
  },
);

test('routes evidence IDs and retrieval time through translated placeholders', () => {
  translated.mockClear();
  const diseaseCopy = getDiseaseHypothesisCopy();
  const conversationCopy = getRagConversationCopy();
  const externalCopy = getExternalMedicalEvidenceCopy();

  expect(diseaseCopy.source('record-1')).toBe(
    'translated:diseaseHypotheses.source:record-1',
  );
  expect(conversationCopy.source('record-2')).toBe(
    'translated:ragConversation.source:record-2',
  );
  expect(externalCopy.retrievedAt('2026-10-07T03:00:00.000Z')).toBe(
    'translated:externalMedicalEvidence.retrievedAt:2026-10-07T03:00:00.000Z',
  );
  expect(externalCopy.publicationDate('2024-03-01')).toBe(
    'translated:externalMedicalEvidence.publicationDate:2024-03-01',
  );
  expect(externalCopy.updatedDate('2024-03-02')).toBe(
    'translated:externalMedicalEvidence.updatedDate:2024-03-02',
  );
  expect(externalCopy.source('Europe PMC')).toBe(
    'translated:externalMedicalEvidence.source:Europe PMC',
  );
});
