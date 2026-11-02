import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
import { runVisitQuestionWorkflow } from '../../../agent/visitQuestions/workflow';
import {
  preparedContext,
  makeProvider,
  selectedOption,
} from '../../../agent/visitQuestions/testing/workflowFixtures';

jest.mock('../visitQuestionsContextLoader', () => ({
  loadVisitQuestionsContext: jest.fn(),
}));
jest.mock('../../../agent/visitQuestions/workflow', () => ({
  runVisitQuestionWorkflow: jest.fn(),
}));

test('builds each generation from the latest prepared evidence snapshot', async () => {
  const first = preparedContext();
  const second = preparedContext();
  const changedEvidence = {
    ...second.initialEvidence,
    sourceRevision: 'source-revision-after-edit',
    evidenceId: 'private-span-after-edit',
    evidenceRevision: 'span-revision-after-edit',
    locator: {
      kind: 'structured_record' as const,
      recordId: 'private-span-after-edit',
    },
    content: '합성 기록의 변경된 내용입니다.',
  };
  const changedContext = {
    ...second,
    initialEvidence: changedEvidence,
    evidence: {
      ...second.evidence,
      batch: {
        ...second.evidence.batch,
        items: [changedEvidence],
      },
      metadataByCitation: new Map(),
    },
  };
  const snapshots = [first, changedContext];
  const prepare = jest.fn(async () => snapshots.shift()!);
  jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
    prepareUpcomingVisitQuestionContext: prepare,
  } as never);
  const observedContent: string[] = [];
  jest.mocked(runVisitQuestionWorkflow).mockImplementation(async input => {
    observedContent.push(input.prepared.evidence.batch.items[0]!.content);
    return {
      status: 'needs_clarification',
      message: '현재 근거를 확인해 주세요.',
      memoryStatus: 'available',
    } as never;
  });
  const { provider } = makeProvider([]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const input = {
    appointment: first.appointment,
    selectedAi: {
      status: 'ready' as const,
      selection,
      option,
      provider: option.provider,
      modelId: selection.modelId,
      recipient: 'device',
      remoteProcessing: false,
    },
    confirmConsent: async () => true,
    signal: new AbortController().signal,
  };

  // Re-generation after an evidence edit must read through to the new source revision.
  await defaultVisitQuestionRouteOperations.generate(input);
  await defaultVisitQuestionRouteOperations.generate(input);

  expect(prepare).toHaveBeenCalledTimes(2);
  expect(observedContent).toEqual([
    first.initialEvidence.content,
    changedEvidence.content,
  ]);
});
