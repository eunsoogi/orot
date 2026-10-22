import type { ComponentProps } from 'react';
import type { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import { evidenceVisualReference } from './evidenceVisualFixtures';

export const syntheticConversationAnswer =
  '합성 기록에는 복약, 활동과 수면 정보가 함께 있어요. 실제 증상의 원인을 확정한 답변은 아니에요.';

/** Explicit local UI fixture: no storage, retrieval engine, network or model is invoked. */
export const sendSyntheticConversation: ComponentProps<
  typeof ConversationScreen
>['onSend'] = async (question, _history, signal, observer) => {
  if (question.includes('failure')) return { status: 'unavailable' };
  observer?.onTaskStreamEvent?.({ type: 'started' });
  observer?.onTaskStreamEvent?.({
    type: 'text_delta',
    text: syntheticConversationAnswer,
  });
  if (question.includes('pending')) {
    // Stay pending until the real Stop action aborts; do not make timing determine the state.
    return new Promise(resolve => {
      if (signal?.aborted) resolve({ status: 'unavailable' });
      else
        signal?.addEventListener(
          'abort',
          () => resolve({ status: 'unavailable' }),
          { once: true },
        );
    });
  }
  return {
    status: 'answer',
    answer: syntheticConversationAnswer,
    citations: [evidenceVisualReference],
  };
};
