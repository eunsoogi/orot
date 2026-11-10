import type { SafetyPolicyAction } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import { t } from '../i18n';
import type { ConversationSender } from '../ragConversation/conversationSessionTypes';
import type { TreatmentExplanationRequest } from './interfaces';
import { produceTreatmentRequest } from './treatmentRequestProducer';
import type { TreatmentRequestAction } from './treatmentRequestProducer';
import { treatmentSafetyGuidance } from './treatmentSafetyGuidance';

const treatmentSenderBrand: unique symbol = Symbol('treatment-sender');
export type TreatmentConversationSender = ConversationSender & {
  readonly [treatmentSenderBrand]: true;
};

/** Build only from a typed user action; no text classifier may start treatment work. */
export function treatmentConversationSender(input: {
  readonly database: SqlDatabase;
  readonly action: TreatmentRequestAction;
  readonly request: TreatmentExplanationRequest;
  readonly actions: readonly SafetyPolicyAction[];
}): TreatmentConversationSender {
  const sender: ConversationSender = async (_question, _history, signal) => {
    const result = await produceTreatmentRequest(
      input.database,
      input.action,
      input.request,
      signal ?? new AbortController().signal,
      input.actions,
    );
    if (result.status === 'validated') {
      return {
        status: 'answer',
        answer: result.claims.map(claim => claim.text).join('\n'),
        citations: result.claims.flatMap(claim => claim.citations),
        completion: 'partial',
      };
    }
    if (result.status === 'urgent') {
      const guidance = treatmentSafetyGuidance(result);
      if (guidance.length)
        return {
          status: 'answer',
          answer: guidance.map(key => t(key)).join('\n'),
          citations: [],
        };
    }
    return {
      status: 'failure',
      kind:
        result.status === 'withheld' && result.reason === 'cancelled'
          ? 'cancelled'
          : 'validation_failed',
    };
  };
  return Object.assign(sender, { [treatmentSenderBrand]: true as const });
}
