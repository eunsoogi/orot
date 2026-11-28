import type {
  EncounterTranscript,
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import {
  providerFailure,
  providerSuccess,
  type LanguageModelProvider,
} from '@orot/model-runtime';
import {
  protectedEncounterPageWire,
  type ProtectedEncounterPageWire,
} from '@orot/provider-openai';

type Entry = Readonly<{
  operation: string;
  account: string;
  model: string;
  source: string;
  revisions: readonly Readonly<{ id: string; revision: number }>[];
  wire: ProtectedEncounterPageWire;
}>;

type Submission = Readonly<{
  stop: () => void;
  terminal: Promise<Readonly<{ text: string }> | null>;
}>;

/** A native owner must independently prove the entry against its own current
 * approved source and selection and submit atomically. No ordinary response
 * bridge implements this interface; never adapt an async enqueue call to it. */
export interface NativeChatGPTEncounterPageOwner {
  prepare(
    entry: Entry,
    signal: AbortSignal,
  ): Promise<Readonly<{
    cancel: () => void;
    admitAndSubmit: () => Submission | null;
  }> | null>;
}

function sameWire(
  a: ProtectedEncounterPageWire,
  b: ProtectedEncounterPageWire,
) {
  return (
    a.instruction === b.instruction &&
    a.transcript === b.transcript &&
    a.citations === b.citations &&
    a.schema === b.schema
  );
}

/** Binds one stock authorized outbound page to one native submission. */
export function bindChatGPTPlanPageDispatch(input: {
  consent: ExecutionConsentPort;
  transcript: EncounterTranscript;
  operation: string;
  account: string;
  providerId: string;
  model: string;
  recipient: string;
  isCurrent: () => boolean;
  native: NativeChatGPTEncounterPageOwner;
}): {
  consent: ExecutionConsentPort;
  generate: LanguageModelProvider['generate'];
} {
  const { consent, native, account, model, operation, recipient, providerId } =
    input;
  const source = input.transcript.sourceId;
  const revisions = Object.freeze(
    input.transcript.segments.map(({ id, revision }) =>
      Object.freeze({ id, revision }),
    ),
  );
  let approved: OutboundProcessingRequest | undefined;
  let wire: ProtectedEncounterPageWire | undefined;
  let attempted = false;
  let submitted = false;
  let retired = false;
  const active = () => {
    if (retired) return false;
    try {
      if (input.isCurrent()) return true;
    } catch {
      // An unavailable witness cannot become valid again within this page.
    }
    retired = true;
    return false;
  };
  const scope = (r: OutboundProcessingRequest) =>
    account.length > 0 &&
    revisions.length > 0 &&
    r.operationRunId === operation &&
    r.providerId === providerId &&
    r.modelId === model &&
    r.recipient === recipient &&
    r.remoteProcessing === true &&
    r.consentScope?.purpose === 'encounter_transcript_review' &&
    r.consentScope.policyVersion === 'single-recording-v1' &&
    r.consentScope.dataCategories.length === 1 &&
    r.consentScope.dataCategories[0] === 'selected_recording_transcript' &&
    r.allowedScope.sourceKinds.length === 1 &&
    r.allowedScope.sourceKinds[0] === 'personal_record' &&
    r.allowedScope.sourceIds?.length === 1 &&
    r.allowedScope.sourceIds[0] === source;
  const current = (r: OutboundProcessingRequest): boolean => {
    if (approved !== r) return false;
    try {
      const saved = wire && protectedEncounterPageWire(r.payload);
      return Boolean(
        approved === r &&
        !r.signal.aborted &&
        active() &&
        scope(r) &&
        saved &&
        wire &&
        sameWire(wire, saved) &&
        consent.isAuthorizationCurrent?.(r) === true,
      );
    } catch {
      return false;
    }
  };
  const unavailable = () =>
    providerFailure({
      code: 'provider_unavailable',
      message: 'The selected transcript page is unavailable.',
      retryable: false,
    });
  return {
    consent: {
      async authorize(r) {
        if (
          attempted ||
          !active() ||
          r.signal.aborted ||
          !scope(r) ||
          !consent.isAuthorizationCurrent ||
          !consent.subscribeAuthorizationInvalidation
        )
          return 'renewal_required';
        attempted = true;
        const payload = protectedEncounterPageWire(r.payload);
        if (!payload || (await consent.authorize(r)) !== 'authorized')
          return 'renewal_required';
        approved = r;
        wire = payload;
        return current(r) ? 'authorized' : 'renewal_required';
      },
      isAuthorizationCurrent: current,
      subscribeAuthorizationInvalidation(r, listener) {
        if (!current(r)) {
          listener();
          return () => {};
        }
        return consent.subscribeAuthorizationInvalidation!(r, () => {
          retired = true;
          listener();
        });
      },
    },
    async generate(request, options) {
      const signal = options?.signal;
      const saved = approved;
      try {
        if (
          !signal ||
          signal.aborted ||
          submitted ||
          !saved ||
          !wire ||
          options?.midTurnSteering ||
          !current(saved)
        )
          return unavailable();
        const payload = protectedEncounterPageWire(request);
        if (!payload || !sameWire(wire, payload) || !current(saved))
          return unavailable();
        // Preparing refreshes the selected account but cannot start Responses.
        // The exact original grant is live again before the opaque native arm.
        submitted = true;
        const prepared = await native.prepare(
          Object.freeze({ operation, account, model, source, revisions, wire }),
          signal,
        );
        if (!prepared) return unavailable();
        if (signal.aborted || !current(saved)) {
          prepared.cancel();
          return unavailable();
        }
        const call = prepared.admitAndSubmit();
        if (!call) {
          prepared.cancel();
          return unavailable();
        }
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          try {
            call.stop();
          } catch {
            // A failed stop request cannot make any later terminal admissible.
          }
        };
        signal.addEventListener('abort', stop, { once: true });
        try {
          if (signal.aborted || !current(saved)) {
            stop();
            // Own the definite terminal even if the operation was just retired.
            call.terminal.catch(() => undefined);
            return unavailable();
          }
          const terminal = await call.terminal;
          if (
            !terminal ||
            Object.keys(terminal).length !== 1 ||
            typeof terminal.text !== 'string' ||
            !terminal.text.trim() ||
            signal.aborted ||
            !current(saved)
          )
            return unavailable();
          return providerSuccess({
            text: terminal.text,
            toolCalls: [],
            finishReason: 'complete',
          });
        } finally {
          signal.removeEventListener('abort', stop);
        }
      } catch {
        return unavailable();
      }
    },
  };
}
