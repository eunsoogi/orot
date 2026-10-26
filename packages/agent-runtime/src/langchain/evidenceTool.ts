import { StructuredTool, ToolInputParsingException } from '@langchain/core/tools';
import type {
  StructuredToolCallInput,
  ToolReturnType,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import type { BaseStore } from '@langchain/langgraph/web';
import { ToolMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages';
import { Validator } from '@langchain/core/utils/json_schema';
import type { JsonObject } from '@orot/model-runtime';
import type {
  EvidenceBatch,
  EvidenceReference,
  EvidenceSearchRequest,
  EvidenceSearchTool,
} from '../multiAgent/evidenceContracts';
import { MAX_MULTI_AGENT_BUDGET } from '../multiAgent/evidenceContracts';
import {
  isEvidenceReference,
  isSourceAllowed,
  referencesFromBatch,
  validateEvidenceBatch,
} from '../multiAgent/evidence';
import { toolProviderStop, validToolModelCost } from '../multiAgent/evidenceToolModelBudget';
import { observeUntilAbort } from '../multiAgent/modelCall';
import { canonicalJson, utf8ByteLength } from '../multiAgent/protocol';

type SearchFailure = {
  readonly status:
    | 'budget_exceeded'
    | 'consent_required'
    | 'cancelled'
    | 'invalid_input'
    | 'invalid_output'
    | 'stale_evidence'
    | 'unavailable';
};

export type EvidenceSearchReservation =
  Omit<EvidenceSearchRequest, 'input' | 'signal'> | SearchFailure;

/** Invocation-local capabilities are supplied by the host, never runnable config or model input. */
export interface TrustedEvidenceToolContext {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  /** Atomically reserve/checkpoint shared tool and delegated model costs, keeping a responder slot.
   * Return remaining item capacity and a unique operation key; denied/failed calls are not refunded. */
  reserveSearch(
    tool: EvidenceSearchTool,
  ): EvidenceSearchReservation | Promise<EvidenceSearchReservation>;
  revalidateEvidence(
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ): Promise<boolean>;
  /** LangGraph's persistent store stays host-owned and is never copied into the tool schema. */
  readonly store?: BaseStore;
}

/** Standard call() emits health queries before consent and results afterwards, including to
 * ambient tracers. Own invocation here so validation and ToolNode delivery never enter callbacks.
 * Keep failures payload-free; global tracing settings and other runnables remain host-owned. */
class PrivateEvidenceTool extends StructuredTool<JsonObject, unknown, unknown, string> {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonObject;
  private readonly validator: Validator;
  constructor(
    domain: EvidenceSearchTool,
    private readonly execute: (value: unknown) => Promise<string>,
  ) {
    super();
    this.name = domain.id;
    this.description = domain.description;
    this.schema = domain.inputSchema;
    this.validator = new Validator(this.schema);
  }
  protected _call(value: unknown) {
    return this.execute(value);
  }
  async invoke<
    TInput extends StructuredToolCallInput<JsonObject, unknown>,
    TConfig extends ToolRunnableConfig | undefined,
  >(input: TInput, config?: TConfig): Promise<ToolReturnType<TInput, TConfig, string>> {
    const candidate: unknown = input;
    const call =
      candidate && typeof candidate === 'object' && (candidate as ToolCall).type === 'tool_call'
        ? (candidate as ToolCall)
        : undefined;
    const value = call ? call.args : input;
    let valid = false;
    try {
      valid = this.validator.validate(value).valid;
    } catch {
      /* Fail closed without including input. */
    }
    if (!valid)
      throw new ToolInputParsingException('Received tool input did not match expected schema', '');
    const content = await this._call(value);
    const id = call?.id ?? config?.toolCall?.id;
    return (
      id === undefined ? content : new ToolMessage({ content, tool_call_id: id, name: this.name })
    ) as ToolReturnType<TInput, TConfig, string>;
  }
  call<
    TInput extends StructuredToolCallInput<JsonObject, unknown>,
    TConfig extends ToolRunnableConfig | undefined,
  >(input: TInput, config?: TConfig): Promise<ToolReturnType<TInput, TConfig, string>> {
    return this.invoke(input, config);
  }
}

/** Transport adapter only: host owns scheduling, consent, shared counters and combined-result
 * duplicate/freshness/coverage checks plus nativeToolResultMode projection. Do not reserve twice
 * when integrating with prepareEvidenceSearch; consume its persisted reservation instead. */
export function createLangChainEvidenceTool(
  domain: EvidenceSearchTool,
  context: TrustedEvidenceToolContext,
) {
  if (
    !validToolModelCost(domain) ||
    (domain.execution === 'external_read_only') !== (domain.sourceKind === 'external_medical')
  ) {
    throw new Error('The evidence tool has an invalid execution boundary.');
  }
  return new PrivateEvidenceTool(
    domain,
    // The local invocation validates JSON Schema before entering this function. The domain parser
    // adds its semantic constraints; neither step may allocate a search on invalid input.
    async (value: unknown) => {
      let started = false;
      const failure = (status: SearchFailure['status']) =>
        JSON.stringify(
          status === 'cancelled'
            ? context.timedOut()
              ? { status: 'budget_exceeded' }
              : { status, providerStop: started ? toolProviderStop(domain) : 'not_started' }
            : { status },
        );
      if (context.signal.aborted) return failure('cancelled');
      let input;
      try {
        input = domain.parseInput(value);
      } catch {
        return failure('invalid_input');
      }
      if (!input) return failure('invalid_input');
      let reserved: EvidenceSearchReservation;
      try {
        const reservation = await observeUntilAbort(
          Promise.resolve().then(() => context.reserveSearch(domain)),
          context.signal,
        );
        if (reservation.kind === 'cancelled') return failure('cancelled');
        if (reservation.kind === 'error') return failure('unavailable');
        reserved = reservation.value;
      } catch {
        return failure('unavailable');
      }
      if ('status' in reserved) return failure(reserved.status);
      if (context.signal.aborted) return failure('cancelled');
      if (
        !Number.isSafeInteger(reserved.resultLimit) ||
        reserved.resultLimit < 1 ||
        reserved.resultLimit > MAX_MULTI_AGENT_BUDGET.maxEvidenceItems ||
        !Number.isSafeInteger(reserved.maxPayloadBytes) ||
        reserved.maxPayloadBytes < 1 ||
        reserved.maxPayloadBytes > MAX_MULTI_AGENT_BUDGET.maxPayloadBytes ||
        utf8ByteLength(canonicalJson(input)) > reserved.maxPayloadBytes
      ) {
        return failure('budget_exceeded');
      }
      if (!isSourceAllowed(reserved.allowedScope, domain.sourceKind))
        return failure('invalid_input');
      try {
        const observed = await observeUntilAbort(
          Promise.resolve().then(() => {
            if (context.signal.aborted) throw new Error('Search cancelled before dispatch.');
            started = true;
            return domain.search(
              { ...reserved, input, signal: context.signal },
              context.store ? { store: context.store } : undefined,
            );
          }),
          context.signal,
        );
        // The observer detaches on settlement; cancellation can win before this continuation runs.
        if (observed.kind === 'cancelled' || context.signal.aborted) return failure('cancelled');
        if (observed.kind === 'error') return failure('unavailable');
        const batch = observed.value;
        // External adapters retain their separate query-consent port and run it before networking.
        if ('status' in batch)
          return failure(
            batch.status === 'consent_required' ? 'consent_required' : 'invalid_output',
          );
        if (utf8ByteLength(canonicalJson(batch)) > reserved.maxPayloadBytes)
          return failure('budget_exceeded');
        if (!validBatch(batch, domain, reserved)) return failure('invalid_output');
        const fresh =
          batch.items.length === 0
            ? { kind: 'value' as const, value: true }
            : await observeUntilAbort(
                Promise.resolve().then(() =>
                  context.revalidateEvidence(referencesFromBatch(batch), context.signal),
                ),
                context.signal,
              );
        if (fresh.kind === 'cancelled' || context.signal.aborted) return failure('cancelled');
        if (fresh.kind !== 'value' || !fresh.value) return failure('stale_evidence');
        return canonicalJson({ status: 'result', batch });
      } catch {
        // Never disclose adapter exceptions or partial health payloads in model-visible failures.
        return failure(context.signal.aborted ? 'cancelled' : 'invalid_output');
      }
    },
  );
}

function validBatch(
  batch: EvidenceBatch,
  domain: EvidenceSearchTool,
  reserved: Exclude<EvidenceSearchReservation, SearchFailure>,
): boolean {
  return (
    !validateEvidenceBatch(batch, reserved.allowedScope, {
      ...MAX_MULTI_AGENT_BUDGET,
      maxEvidenceItems: reserved.resultLimit,
    }) &&
    batch.items.every(
      (item) => isEvidenceReference(item) && item.sourceKind === domain.sourceKind,
    ) &&
    batch.coverage.length > 0 &&
    batch.coverage.every((coverage) => coverage.sourceKind === domain.sourceKind)
  );
}
