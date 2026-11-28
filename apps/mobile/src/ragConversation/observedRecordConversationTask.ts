import { observedRecordAnswerPolicy } from '../agent/execution/observedRecordAnswerPolicy';
import type { TaskResponderContract } from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';

const legacyMissingRequestedInformation =
  'Explain any missing requested information directly in the answer. Never bypass evidence or citation requirements. ';

/** Only fresh text sends opt into the new response policy. A saved task keeps
 * its original version, exact prompt and result contract. */
export function withObservedRecordAnswers(
  base: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...base,
    taskVersion: '70',
    systemPrompt:
      base.systemPrompt.replace(
        legacyMissingRequestedInformation,
        'Keep exact evidence and citation requirements. ',
      ) +
      ' ' +
      observedRecordAnswerPolicy,
  };
}
