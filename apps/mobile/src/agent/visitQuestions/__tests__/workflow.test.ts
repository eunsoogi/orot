import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { DoseEventSchema } from '@orot/domain';
import { chunkStructuredRecord } from '@orot/rag';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';
import { runVisitQuestionWorkflow } from '../workflow';

describe('visit-question shared workflow', () => {
  it('hands off bounded research, restores exact citations, and refreshes remote consent', async () => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
    );
    const { selection, option } = selectedOption(provider);
    const consentRequests: OutboundProcessingRequest[] = [];
    const confirmConsent = jest.fn(
      async (request: OutboundProcessingRequest) => {
        consentRequests.push(request);
        return true;
      },
    );

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      recipient: 'ChatGPT account selected for this run',
      confirmConsent,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]?.citations).toEqual([
      prepared.supplementalEvidence,
    ]);
    expect(prepared.searchEvidence).toHaveBeenCalledWith(
      '최근 검사 결과',
      expect.any(Number),
      'personal_record',
      expect.any(AbortSignal),
    );
    expect(prepared.revalidateEvidence).toHaveBeenCalledWith(
      expect.arrayContaining([
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ]),
    );
    expect(requests).toHaveLength(3);
    expect(confirmConsent).toHaveBeenCalledTimes(3);
    expect(
      new Set(consentRequests.map(request => JSON.stringify(request.payload)))
        .size,
    ).toBe(3);
    expect(JSON.stringify(requests)).not.toContain('private-source-');
    expect(JSON.stringify(requests)).not.toContain('private-span-');
  });

  it('asks for clarification when supplemental evidence reveals a conflict', async () => {
    const prepared = preparedContext();
    const preparedWithConflict = {
      ...prepared,
      searchEvidence: async (
        ...args: Parameters<typeof prepared.searchEvidence>
      ) => {
        const supplemental = await prepared.searchEvidence(...args);
        return {
          ...supplemental,
          batch: {
            ...supplemental.batch,
            conflicts: ['Conflicting health observation values exist.'],
          },
        };
      },
    };
    const { provider } = makeProvider(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
    );
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared: preparedWithConflict,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('needs_clarification');
  });

  it('accepts the structured dose unit and rejects a substituted unit', async () => {
    const prepared = preparedContext();
    const doseEvent = DoseEventSchema.parse({
      id: 'dose-event-1',
      effectiveAt: '2026-09-01T12:00:00.000Z',
      recordedAt: '2026-09-01T12:00:00.000Z',
      ingestedAt: '2026-09-01T12:00:00.000Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      eventKind: 'taken',
      medicationAssertionId: 'medication-assertion-1',
      dose: { amount: 5, unit: 'mg' },
    });
    const initialEvidence = {
      ...prepared.initialEvidence,
      content: chunkStructuredRecord('dose_event', doseEvent).text,
    };
    const batch = {
      ...prepared.evidence.batch,
      items: [initialEvidence],
    };
    const preparedWithDose = {
      ...prepared,
      initialEvidence,
      evidence: { ...prepared.evidence, batch },
    };
    const alias = createVisitQuestionEvidenceAliases(batch).batch.items[0]!;
    const citation = {
      sourceKind: alias.sourceKind,
      sourceId: alias.sourceId,
      sourceRevision: alias.sourceRevision,
      evidenceId: alias.evidenceId,
      evidenceRevision: alias.evidenceRevision,
      locator: alias.locator,
      effectiveTime: alias.effectiveTime,
      reviewState: alias.reviewState,
    };

    const runWithQuestion = async (questionText: string) => {
      const questions = [
        {
          questionText,
          rationale: '복용량 기록을 의료진과 확인할 수 있어요.',
          priority: 'routine',
          evidenceIds: [alias.evidenceId],
        },
        {
          questionText: '현재 투약 기록에서 무엇을 확인할까요?',
          rationale: '기록된 투약 내용을 질문할 수 있어요.',
          priority: 'routine',
          evidenceIds: [alias.evidenceId],
        },
        {
          questionText: '복용 후 기록할 내용이 있을까요?',
          rationale: '진료 전 기록 방법을 확인할 수 있어요.',
          priority: 'important',
          evidenceIds: [alias.evidenceId],
        },
      ];
      const { provider } = makeProvider([
        JSON.stringify({
          type: 'result',
          value: { status: 'suggestions', questions },
          citations: [citation],
        }),
      ]);
      const { selection, option } = selectedOption(provider, 'on-device');
      return runVisitQuestionWorkflow({
        prepared: preparedWithDose,
        selection,
        providerOptions: [option],
      });
    };

    expect(
      (await runWithQuestion('복용량 5 mg을 진료에서 확인할까요?')).status,
    ).toBe('ready');
    expect(
      (await runWithQuestion('복용량 5 g을 진료에서 확인할까요?')).status,
    ).toBe('needs_clarification');
  });

  it('does not call the selected provider when remote payload consent is declined', async () => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider([
      JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
    ]);
    const { selection, option } = selectedOption(provider);
    const confirmConsent = jest.fn(async () => false);

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      recipient: 'ChatGPT account selected for this run',
      confirmConsent,
    });

    expect(result.status).toBe('consent_required');
    expect(confirmConsent).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
  });

  it('stops after cancellation before dispatching a role or local search', async () => {
    const prepared = preparedContext();
    const controller = new AbortController();
    const { provider, requests } = makeProvider(
      [JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' })],
      () => controller.abort(),
    );
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(requests).toHaveLength(1);
    expect(prepared.searchEvidence).not.toHaveBeenCalled();
  });
});
