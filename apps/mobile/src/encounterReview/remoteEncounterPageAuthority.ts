import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import type { SettingsConsentOwner } from '../agent/execution/settingsConsentAuthorization';

type Target = Pick<
  OutboundProcessingRequest,
  'providerId' | 'modelId' | 'recipient'
>;

/** One payload-free settings owner persists through review, but never grants
 * transport. Each exact outbound page still goes through ordinary consent. */
export function bindRemoteEncounterPageAuthority(input: {
  readonly owner: SettingsConsentOwner;
  readonly target: Target;
  readonly sourceId: string;
  readonly consent: ExecutionConsentPort;
  readonly active: () => boolean;
}) {
  const { owner, sourceId, consent } = input;
  const target = { ...input.target };
  if (
    owner.slot !== 'conversation' ||
    owner.domain !== 'model' ||
    owner.identity.providerId !== target.providerId ||
    owner.identity.modelId !== target.modelId ||
    owner.identity.recipient !== target.recipient ||
    !owner.subscribeInvalidation ||
    !consent.isAuthorizationCurrent ||
    !consent.subscribeAuthorizationInvalidation
  )
    return null;
  let retired = false;
  let denied = false;
  const current = () => {
    if (retired) return false;
    try {
      if (input.active() && owner.isCurrent()) return true;
    } catch {
      // A stale owner cannot return on the strength of a later recheck.
    }
    retired = true;
    return false;
  };
  if (!current()) return null;
  const matches = (request: OutboundProcessingRequest) =>
    current() &&
    !request.signal.aborted &&
    request.remoteProcessing === true &&
    request.providerId === target.providerId &&
    request.modelId === target.modelId &&
    request.recipient === target.recipient &&
    request.consentScope?.purpose === 'encounter_transcript_review' &&
    request.consentScope.policyVersion === 'single-recording-v1' &&
    request.consentScope.dataCategories.length === 1 &&
    request.consentScope.dataCategories[0] ===
      'selected_recording_transcript' &&
    request.allowedScope.sourceKinds.length === 1 &&
    request.allowedScope.sourceKinds[0] === 'personal_record' &&
    request.allowedScope.sourceIds?.length === 1 &&
    request.allowedScope.sourceIds[0] === sourceId;
  // Only the authorization port may retain the exact request witness. The
  // surrounding operation retains identity without holding any page payload.
  const port: ExecutionConsentPort = {
    async authorize(request) {
      if (!matches(request)) return 'renewal_required';
      const decision = await consent.authorize(request);
      if (!matches(request)) return 'renewal_required';
      if (decision !== 'authorized') denied = true;
      return decision;
    },
    isAuthorizationCurrent: request =>
      matches(request) && consent.isAuthorizationCurrent?.(request) === true,
    subscribeAuthorizationInvalidation(request, listener) {
      if (!matches(request)) {
        listener();
        return () => {};
      }
      const check = () => {
        if (!current()) listener();
      };
      const stopOwner = owner.subscribeInvalidation?.(check);
      const stopConsent = consent.subscribeAuthorizationInvalidation?.(
        request,
        listener,
      );
      check();
      return () => {
        stopOwner?.();
        stopConsent?.();
      };
    },
  };
  return {
    current,
    denied: () => denied,
    port,
    subscribe(listener: () => void) {
      const check = () => {
        if (!current()) listener();
      };
      const stop = owner.subscribeInvalidation?.(check);
      check();
      return stop ?? (() => {});
    },
  };
}
