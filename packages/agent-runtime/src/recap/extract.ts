import {
  RecapInputSchema,
  RecapResultSchema,
  recapModelJsonSchema,
  recapReferenceJsonSchema,
} from '@orot/domain';
import type { RecapInput, RecapQuestionResult, RecapResult } from '@orot/domain';
import type {
  JsonObject,
  LanguageModelProvider,
  LanguageModelRequest,
  ProviderErrorCode,
} from '@orot/model-runtime';
import type { ExecutionConsentPort, MultiAgentExecutionIdentity } from '../multiAgent/contracts';
import { v4 as createUuid } from '@langchain/core/utils/uuid';
import { callModel, observeUntilAbort } from '../multiAgent/modelCall';
import { recapChunks, RecapChunkBudgetError } from './chunks';
import { mergeRecapQuestions, validateRecapChunk } from './validation';
import { recapUnits, recapUnitChunks, type RecapUnit } from './units';
import { validateReferenceChunk } from './referenceValidation';
import { instructions, referenceInstructions } from './instructions';

export type RecapExtractionOutcome =
  | { status: 'result'; value: RecapResult }
  | {
      status:
        | 'invalid_input'
        | 'invalid_output'
        | 'stale_source'
        | 'cancelled'
        | 'consent_required'
        | 'budget_exceeded'
        | 'no_questions';
    }
  | { status: 'unavailable'; errorCode: ProviderErrorCode };

export interface RecapExtractionOptions {
  input: RecapInput;
  provider: LanguageModelProvider;
  execution: MultiAgentExecutionIdentity;
  consent: ExecutionConsentPort;
  /** Must compare source existence, visit association, question text/IDs and all current transcript revisions. */
  isCurrent: (snapshot: RecapInput) => Promise<boolean>;
  signal: AbortSignal;
  evidenceMode?: 'references';
}

/** Consent is for exact outbound data only. Validated uncertainty is returned for automatic saving, without content approval. */
export async function extractTranscriptRecap(
  options: RecapExtractionOptions,
): Promise<RecapExtractionOutcome> {
  const { signal, provider, execution } = options;
  if (signal.aborted) return { status: 'cancelled' };
  let input: RecapInput;
  let chunks: ReturnType<typeof recapChunks>;
  let allUnits: RecapUnit[] = [];
  let unitChunks: RecapUnit[][] = [];
  try {
    input = RecapInputSchema.parse(options.input);
    const scope = execution.allowedScope;
    if (
      execution.providerId !== provider.id ||
      !execution.modelId.trim() ||
      scope.sourceKinds.length !== 1 ||
      scope.sourceKinds[0] !== 'personal_record' ||
      scope.sourceIds?.length !== 1 ||
      scope.sourceIds[0] !== input.recordingSourceId
    ) {
      return { status: 'invalid_input' };
    }
    if (!input.questions.length) return { status: 'no_questions' };
    if (options.evidenceMode === 'references') {
      allUnits = recapUnits(input);
      unitChunks = recapUnitChunks(allUnits);
      if (unitChunks.length > 64) return { status: 'budget_exceeded' };
      chunks = [];
    } else chunks = recapChunks(input);
  } catch (error) {
    return { status: error instanceof RecapChunkBudgetError ? 'budget_exceeded' : 'invalid_input' };
  }
  if (
    !Number.isInteger(execution.budget.maxModelCalls) ||
    (options.evidenceMode === 'references' ? unitChunks.length : chunks.length) >
      execution.budget.maxModelCalls
  ) {
    return { status: 'budget_exceeded' };
  }
  const current = async () => {
    const observed = await observeUntilAbort(
      Promise.resolve().then(() => options.isCurrent(input)),
      signal,
    );
    return observed.kind === 'value' && observed.value;
  };
  let questions: RecapQuestionResult[] = [];
  // A short, per-extraction nonce binds each response to the snapshot held locally.
  const requestRunId = options.evidenceMode === 'references' ? createUuid() : '';
  const chunkCount = options.evidenceMode === 'references' ? unitChunks.length : chunks.length;
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    if (!(await current())) return { status: signal.aborted ? 'cancelled' : 'stale_source' };
    const chunk = chunks[chunkIndex];
    const unitChunk = unitChunks[chunkIndex];
    const requestRef = `${requestRunId}:${chunkIndex}`;
    const schema =
      options.evidenceMode === 'references' ? recapReferenceJsonSchema : recapModelJsonSchema;
    const request: LanguageModelRequest = {
      // Providers that do not expose this control retain their own output limit.
      ...(provider.capabilities.requestControls?.includes('maxOutputTokens')
        ? { maxOutputTokens: execution.budget.maxOutputTokens }
        : {}),
      messages: [
        {
          role: 'system',
          content: options.evidenceMode === 'references' ? referenceInstructions : instructions,
        },
        {
          role: 'user',
          content: JSON.stringify({
            ...(options.evidenceMode === 'references'
              ? {
                  requestRef,
                  questions: input.questions.map((question, index) => ({
                    preparedQuestionRef: `q${index}`,
                    questionText: question.questionText,
                  })),
                }
              : {
                  recordingSourceId: input.recordingSourceId,
                  appointmentId: input.appointmentId,
                  chunkIndex,
                  questions: input.questions,
                }),
            transcript:
              options.evidenceMode === 'references'
                ? unitChunk.map(({ ref, text }) => ({ speechRef: ref, text }))
                : chunk,
            priorQuestionEvidence: questions.map((question) => ({
              ...(options.evidenceMode === 'references'
                ? {
                    preparedQuestionRef: `q${input.questions.findIndex((item) => item.id === question.questionId)}`,
                  }
                : { questionId: question.questionId }),
              evidence:
                options.evidenceMode === 'references'
                  ? allUnits
                      .filter((unit) =>
                        question.questionEvidence.some(
                          (item) =>
                            item.segmentId === unit.segmentId &&
                            item.revision === unit.revision &&
                            item.startOffset === unit.startOffset &&
                            item.endOffset === unit.endOffset &&
                            item.quote === unit.text,
                        ),
                      )
                      .map(({ ref, text }) => ({ speechRef: ref, text }))
                  : question.questionEvidence,
            })),
            // JSON prompting remains actual selected-model inference when native guided output is unavailable.
            ...(!provider.capabilities.structuredOutput ? { outputSchema: schema } : {}),
          }),
        },
      ],
      ...(provider.capabilities.structuredOutput
        ? {
            responseFormat: {
              name: 'transcript_recap',
              schema: schema as JsonObject,
            },
          }
        : {}),
    };
    const response = await callModel(
      provider,
      request,
      execution,
      {
        authorize: async (outbound) => {
          const authorized = await options.consent.authorize(outbound);
          // A long consent interaction must not send a deleted/corrected source after approval.
          return authorized === 'authorized' && (await current())
            ? 'authorized'
            : 'renewal_required';
        },
      },
      signal,
    );
    if (signal.aborted) return { status: 'cancelled' };
    if (!(await current())) return { status: signal.aborted ? 'cancelled' : 'stale_source' };
    if (response.status !== 'response') {
      if (response.status === 'cancelled') return { status: 'cancelled' };
      return response;
    }
    try {
      if (response.response.finishReason !== 'complete' || response.response.toolCalls.length) {
        return { status: 'invalid_output' };
      }
      const wire = response.response.structuredOutput ?? JSON.parse(response.response.text);
      questions = mergeRecapQuestions(
        questions,
        options.evidenceMode === 'references'
          ? validateReferenceChunk(
              wire,
              input,
              unitChunk,
              chunkIndex,
              questions,
              allUnits,
              requestRef,
            )
          : validateRecapChunk(wire, input, chunk, chunkIndex, questions),
      );
    } catch {
      return { status: 'invalid_output' };
    }
  }
  return {
    status: 'result',
    value: RecapResultSchema.parse({
      recordingSourceId: input.recordingSourceId,
      appointmentId: input.appointmentId,
      binding: input.binding,
      providerId: execution.providerId,
      modelId: execution.modelId,
      promptVersion: 'transcript-recap-v1',
      chunkCount,
      preparedQuestions: input.questions.map(({ id, questionText, revision }) => ({
        id,
        questionText,
        revision,
      })),
      sources: input.segments.map((segment) => ({
        segmentId: segment.id,
        transcriptId: segment.transcriptId,
        revision: segment.revision,
        audioRange: segment.audioRange,
      })),
      questions,
    }),
  };
}
