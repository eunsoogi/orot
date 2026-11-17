import {
  local,
  paper,
  localClaim,
  paperClaim,
} from '../testSupport/mixedEvidenceReportFixture';
import { render, screen } from '@testing-library/react-native';
import { createElement } from 'react';
import { ConversationMessage } from '../ConversationMessage';
import { parseConversationReport } from '../conversationReportTemplate';
import { t } from '../../i18n';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

// This isolates claim and citation wiring; native deletion storage is checked separately.
jest.mock('../../aiFeatures/integration/deletionAwareEvidence', () => ({
  revalidateWithLocalDeletionGuard: async () => true,
}));

test.each([
  ['기록과 문헌을 비교해 주세요', ['local', 'MED:1']],
  [t('conversationActions.possibilities'), ['local', 'MED:1']],
  [t('conversationActions.possibilities'), ['MED:1']],
])(
  'the actual workflow binds sources and preserves comparison limits for %s with %p',
  async (question, citations) => {
    const f = fixture();
    f.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: 'ignored',
          localClaims: [localClaim],
          literature: [paperClaim],
        },
        citations,
      }),
    );
    const chunk = {
      id: 'local',
      text: local.content,
      metadata: { sourceId: local.sourceId, evidenceId: local.evidenceId },
    };
    const result = await runRagConversationTurn({
      ...f.options,
      question,
      loadCurrentEvidence: async () => ({
        batch: {
          items: [local],
          coverage: [
            {
              sourceKind: 'personal_record',
              searchedSourceIds: ['record'],
              gaps: [],
              truncated: false,
              resultLimit: 1,
              returnedCount: 1,
            },
          ],
          conflicts: [],
        },
        chunks: [chunk as never],
      }),
      rag: { search: async () => [{ chunk, score: 1 }] as never },
      publicEvidence: {
        items: [paper],
        coverage: [
          {
            sourceKind: 'external_medical',
            searchedSourceIds: ['europe-pmc'],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      },
      workflow: {
        ...f.options.workflow,
        execution: {
          ...f.options.workflow.execution,
          allowedScope: {
            sourceKinds: ['personal_record', 'external_medical'],
          },
        },
      },
    });
    if (citations.length === 1) {
      expect(result.status).not.toBe('answer');
      return;
    }
    expect(result.status).toBe('answer');
    if (result.status === 'answer') {
      expect(result).not.toHaveProperty('completion');
      expect(result.answer).toContain(local.content);
      expect(result.answer).toContain('직접적인 비교는 확인하지 못했어요');
      expect(result.citations.map(item => item.evidenceId)).toEqual([
        'local',
        'MED:1',
      ]);
      if (question === t('conversationActions.possibilities')) {
        expect(
          parseConversationReport(result.answer)?.sections.map(
            section => section.title,
          ),
        ).toEqual([
          t('conversationTemplate.possibilities.records'),
          t('conversationTemplate.possibilities.literature'),
          t('conversationTemplate.possibilities.comparisonLimits'),
        ]);
        await render(
          createElement(ConversationMessage, {
            message: { id: 1, role: 'assistant', content: result.answer },
            onOpenSource: jest.fn(),
            onLinkError: jest.fn(),
          }),
        );
        expect(screen.getAllByRole('header')).toHaveLength(4);
        expect(screen.getByText(local.content, { exact: false })).toBeTruthy();
        expect(
          screen.getByText(paperClaim.resultSpan, { exact: false }),
        ).toBeTruthy();
      }
    }
  },
);

test.each(['문헌을 설명해 주세요', '수면과 비만 관련 연구는 어떤가요?'])(
  'a factual literature claim cannot evade source validation for %s',
  async question => {
    const f = fixture();
    f.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: { answerKind: 'conversation', answer: '비만 위험도 40% 증가' },
        citations: [],
      }),
    );
    const result = await runRagConversationTurn({
      ...f.options,
      question,
      loadCurrentEvidence: async () => ({
        batch: { items: [], coverage: [], conflicts: [] },
        chunks: [],
      }),
      publicEvidence: {
        items: [paper],
        coverage: [
          {
            sourceKind: 'external_medical',
            searchedSourceIds: ['europe-pmc'],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      },
    });
    expect(result.status).not.toBe('answer');
  },
);

test('a mixed request rejects a plain grounded answer when only a local record is available', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'grounded', answer: local.content },
      citations: ['local'],
    }),
  );
  const chunk = {
    id: 'local',
    text: local.content,
    metadata: { sourceId: local.sourceId, evidenceId: local.evidenceId },
  };
  const result = await runRagConversationTurn({
    ...f.options,
    question: '내 기록과 문헌을 알려줘',
    loadCurrentEvidence: async () => ({
      batch: {
        items: [local],
        coverage: [
          {
            sourceKind: 'personal_record',
            searchedSourceIds: ['record'],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      },
      chunks: [chunk as never],
    }),
    rag: { search: async () => [{ chunk, score: 1 }] as never },
    workflow: {
      ...f.options.workflow,
      execution: {
        ...f.options.workflow.execution,
        allowedScope: { sourceKinds: ['personal_record', 'external_medical'] },
      },
    },
  });
  expect(f.generate).toHaveBeenCalled();
  expect(result.status).not.toBe('answer');
});

test('a greeting remains conversational even when unrelated literature exists', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'conversation', answer: '천만에요!' },
      citations: [],
    }),
  );
  const result = await runRagConversationTurn({
    ...f.options,
    question: '고마워요',
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    publicEvidence: {
      items: [paper],
      coverage: [
        {
          sourceKind: 'external_medical',
          searchedSourceIds: ['europe-pmc'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
  });
  expect(result).toMatchObject({ status: 'answer', answer: '천만에요!' });
});
