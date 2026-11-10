import { SafetyPolicyEngine } from '@orot/domain';
import type { SafetyPolicyInput } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import { t } from '../i18n';
import type { ConversationSender } from '../ragConversation/conversationSessionTypes';
import type { TreatmentEvidenceRequest } from './interfaces';
import { produceTreatmentRequest } from './treatmentRequestProducer';
import type { TreatmentRequestAction } from './treatmentRequestProducer';
import type { TreatmentRetention } from './treatmentRequestProducer';
import { treatmentSafetyGuidance } from './treatmentSafetyGuidance';
import { evaluateTreatmentOutput } from './treatmentSafetyBoundary';

const treatmentSenderBrand: unique symbol = Symbol('treatment-sender');
export type TreatmentConversationSender = ConversationSender & {
  readonly [treatmentSenderBrand]: true;
};

/** Build only from a typed user action; no text classifier may start treatment work. */
export function treatmentConversationSender(input: {
  readonly database: SqlDatabase | (() => Promise<SqlDatabase>);
  readonly action: TreatmentRequestAction;
  readonly request: TreatmentEvidenceRequest;
  readonly safetyInput: SafetyPolicyInput;
  readonly skipEducation?: boolean;
  readonly prepareRetention?: (
    database: SqlDatabase,
    signal: AbortSignal,
  ) => Promise<TreatmentRetention>;
  readonly onSaved?: (retention: TreatmentRetention) => void;
}): TreatmentConversationSender {
  const sender: ConversationSender = async (_question, _history, signal) => {
    const operation = signal ?? new AbortController().signal;
    const { requiredActions } = new SafetyPolicyEngine().evaluate(
      input.safetyInput,
    );
    if (input.skipEducation && !requiredActions.length && !operation.aborted)
      return {
        status: 'answer',
        answer: t('treatmentSafety.inputRequired'),
        citations: [],
      };
    // Policy and cancellation can resolve without opening storage or starting education.
    let retention: TreatmentRetention | undefined;
    const result =
      requiredActions.length || operation.aborted || input.skipEducation
        ? await evaluateTreatmentOutput(
            null,
            input.request,
            undefined,
            operation,
            requiredActions,
          )
        : await (async () => {
            const database =
              typeof input.database === 'function'
                ? await input.database()
                : input.database;
            if (!operation.aborted)
              retention = await input.prepareRetention?.(database, operation);
            return produceTreatmentRequest(
              database,
              input.action,
              input.request,
              operation,
              [],
              retention,
            );
          })();
    if (result.status === 'validated') {
      if (retention) input.onSaved?.(retention);
      return {
        status: 'answer',
        answer: result.claims.map(claim => claim.text).join('\n'),
        citations: result.claims.flatMap(claim => claim.citations),
        completion: 'partial',
      };
    }
    if (result.status === 'urgent' || result.status === 'policy') {
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
