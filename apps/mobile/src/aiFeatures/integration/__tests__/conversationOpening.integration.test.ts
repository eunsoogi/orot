import { providerSuccess } from '@orot/model-runtime';
import { standardSearchFixture } from '../../../../../../packages/agent-runtime/__tests__/multiAgent-standard-search-fixtures';
import {
  appointment,
  candidate,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { generateConversationVisitQuestions } from '../conversationVisitQuestions';
import type { SelectedAiResolution } from '../provider';
import type { VisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';

/** Synthetic provider/review results prove dispatch and display order, not model prose quality. */
test.each(['ALLOW', 'DENY'])(
  'visit selection opens before final generation; review %s never blocks it',
  async verdict => {
    const f = standardSearchFixture(true);
    const events: string[] = [];
    f.provider.generate
      .mockReset()
      .mockResolvedValueOnce(
        providerSuccess({
          text: '진료에서 나눌 질문을 함께 준비해 볼게요.',
          toolCalls: [],
          finishReason: 'complete',
        }),
      )
      .mockResolvedValueOnce(
        providerSuccess({
          text: verdict,
          toolCalls: [],
          finishReason: 'complete',
        }),
      );
    const selected = {
      status: 'ready',
      provider: f.provider,
      modelId: f.options.execution.modelId,
      recipient: f.options.execution.recipient,
      remoteProcessing: true,
    } as unknown as Extract<SelectedAiResolution, { status: 'ready' }>;
    const generate = jest.fn(async () => {
      expect(events).toEqual(verdict === 'ALLOW' ? ['initial_response'] : []);
      events.push('final');
      return {
        status: 'ready' as const,
        questions: [candidate],
        caveats: [],
        validateSource: async () => true,
      };
    });
    const result = await generateConversationVisitQuestions({
      ownerKey: 'synthetic-opening',
      request: '다음 진료 질문을 준비해 줘',
      operations: {
        loadAppointment: async () => appointment,
        generate,
      } as unknown as VisitQuestionRouteOperations,
      loadSaved: async () => ({
        status: 'ready',
        appointmentId: appointment.id,
        questions: [],
        caveats: [],
        restorationNotice: '',
      }),
      resolveSelectedAi: async () => selected,
      confirmConsent: async () => true,
      isCurrentOwner: () => true,
      signal: new AbortController().signal,
      observer: { onTaskStreamEvent: event => events.push(event.type) },
    });
    expect(result.status).toBe('ready');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(f.provider.generate).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toBe('final');
  },
);
