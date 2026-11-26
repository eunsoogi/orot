import { render } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { ConversationMessageText } from '../ConversationMessageText';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import {
  answer,
  base,
  choice,
  final,
  seedCheck,
  seedChoice,
} from '../testSupport/a2uiLocalFormFixtures';

const valid = [base, seedCheck, seedChoice, final()];
const invalid = [
  base,
  seedCheck,
  seedChoice,
  final({ ...choice, action: { event: { name: 'synthetic-rejected' } } }),
];

const cases = [
  { frames: undefined, expected: 'a2ui_no_frames' },
  { frames: [], expected: 'a2ui_no_frames' },
  { frames: invalid, expected: 'a2ui_invalid_frames' },
  { frames: valid, expected: 'a2ui_admitted' },
] as const;

test.each(cases)(
  'records only the closed final decision and actual React surface commit: $expected',
  async ({ frames, expected }) => {
    const report = jest.fn();
    const original = NativeModules.OrotProviderDiagnostics;
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    try {
      const model = fixture();
      model.generate.mockReset().mockResolvedValueOnce(
        response({
          type: 'result',
          value: {
            answerKind: 'conversation',
            answer,
            ...(frames ? { a2uiFrames: frames } : {}),
          },
          citations: [],
        }),
      );
      const outcome = await runRagConversationTurn({
        ...model.options,
        question: '두 부분을 비교하고 임시 확인 표시를 넣어 주세요.',
        loadCurrentEvidence: async () => ({
          batch: { items: [], coverage: [], conflicts: [] },
          chunks: [],
        }),
      });
      expect(model.generate).toHaveBeenCalledTimes(1);
      if (outcome.status !== 'answer')
        throw new Error('Expected final answer.');
      expect(outcome.answer).toBe(answer);

      const receipts = () =>
        report.mock.calls.filter(
          (call: unknown[]) =>
            call[1] === 'conversation_a2ui_final_admission' ||
            call[1] === 'conversation_a2ui_react_commit',
        );
      const admission = ['rag', 'conversation_a2ui_final_admission', expected];
      expect(receipts()).toEqual([admission]);
      const root = outcome.a2uiPresentation;
      if (expected === 'a2ui_admitted') expect(root).toBeDefined();
      else expect(root).toBeUndefined();

      const ui = await render(
        <ConversationMessageText
          content={answer}
          user={false}
          verifiedA2UI={root}
        />,
      );
      try {
        expect(receipts()).toEqual(
          root
            ? [
                admission,
                ['rag', 'conversation_a2ui_react_commit', 'completed'],
              ]
            : [admission],
        );
      } finally {
        await ui.unmount();
      }
    } finally {
      NativeModules.OrotProviderDiagnostics = original;
    }
  },
);
