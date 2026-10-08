const { createHash } = require('node:crypto');

const PROJECT_NAME = 'orot-visit-questions-synthetic';

// Hash-derived UUIDs make example creation retries idempotent within one dataset.
function stableUuid(value) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Disables ambient LangChain tracing before the graph module is loaded. */
function disableAmbientTracing(env) {
  env.LANGSMITH_TRACING = 'false';
  env.LANGCHAIN_TRACING_V2 = 'false';
  return env;
}

function isLangSmithUploadEnabled(env) {
  return env.OROT_LANGSMITH_EVAL === '1';
}

function getLangSmithApiKey(env) {
  if (!isLangSmithUploadEnabled(env)) return null;
  const apiKey = env.LANGSMITH_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('LangSmith upload is enabled but LANGSMITH_API_KEY is not set.');
  }
  return apiKey;
}

/** Projects fixture inputs into an explicit LangSmith allowlist. */
function toLangSmithExample(testCase, datasetId) {
  const snapshot = testCase.appointment.calendarEventSnapshot;
  const example = {
    inputs: {
      caseId: testCase.caseId,
      query: testCase.query,
      appointment: {
        status: testCase.appointment.status,
        effectiveAt: testCase.appointment.effectiveAt,
        calendarEventIdentifier: testCase.appointment.calendarEventIdentifier,
        calendarEventSnapshot: snapshot
          ? {
              title: snapshot.title,
              timeZoneIdentifier: snapshot.timeZoneIdentifier,
              isAllDay: snapshot.isAllDay,
              occurrenceDate: snapshot.occurrenceDate,
              isDetached: snapshot.isDetached,
              recurrenceRules: snapshot.recurrenceRules,
            }
          : null,
      },
      appointmentContext: {
        effectiveAt: testCase.appointmentContext.effectiveAt,
        timeZoneIdentifier: testCase.appointmentContext.timeZoneIdentifier,
        title: testCase.appointmentContext.title,
        ...(testCase.appointmentContext.reason
          ? { reason: testCase.appointmentContext.reason }
          : {}),
      },
      evidence: testCase.evidence.map((item) => ({
        sourceKind: item.sourceKind,
        sourceId: item.sourceId,
        sourceRevision: item.sourceRevision,
        evidenceId: item.evidenceId,
        evidenceRevision: item.evidenceRevision,
        locator: {
          kind: item.locator.kind,
          ...(item.locator.recordId ? { recordId: item.locator.recordId } : {}),
          ...(item.locator.memoryId ? { memoryId: item.locator.memoryId } : {}),
        },
        effectiveTime: item.effectiveTime,
        reviewState: item.reviewState,
        content: item.content,
      })),
      conflicts: [...testCase.conflicts],
      coverageGaps: [...testCase.coverageGaps],
    },
    outputs: {
      resultMode: testCase.expected.resultMode,
      expectedEvidenceIds: [...testCase.expected.expectedEvidenceIds],
      requiredTerms: [...testCase.expected.requiredTerms],
      appointmentDate: testCase.expected.appointmentDate,
      forbiddenDates: [...testCase.expected.forbiddenDates],
      requiredValues: [...testCase.expected.requiredValues],
      requiredMeasurements: testCase.expected.requiredMeasurements.map((measurement) => ({
        value: measurement.value,
        unit: measurement.unit,
      })),
      unobservedDates: [...testCase.expected.unobservedDates],
    },
  };
  if (!datasetId) return example;

  // Stable identities let an opt-in rerun resume the same fixture without duplicating examples.
  return {
    ...example,
    id: stableUuid(`orot-langsmith-example-v1:${datasetId}:${testCase.caseId}`),
    dataset_id: datasetId,
    // This is LangSmith upload metadata, not a clinical event time from the fixture.
    created_at: new Date().toISOString(),
  };
}

/** Keeps model and execution output to documented fields before any upload. */
function toLangSmithOutput(result, execution) {
  const measuredUsage = execution.tokenUsage;
  const tokenUsage =
    measuredUsage &&
    Number.isInteger(measuredUsage.inputTokens) &&
    measuredUsage.inputTokens >= 0 &&
    Number.isInteger(measuredUsage.outputTokens) &&
    measuredUsage.outputTokens >= 0
      ? {
          status: 'measured',
          inputTokens: measuredUsage.inputTokens,
          outputTokens: measuredUsage.outputTokens,
          totalTokens:
            Number.isInteger(measuredUsage.totalTokens) && measuredUsage.totalTokens >= 0
              ? measuredUsage.totalTokens
              : measuredUsage.inputTokens + measuredUsage.outputTokens,
        }
      : {
          status: 'unmeasured',
          reason: 'The visit-question workflow does not expose token counts.',
        };
  const providerMode = ['real-provider', 'test-adapter'].includes(execution.providerMode)
    ? execution.providerMode
    : 'unknown';
  const latencyMs = Number.isFinite(execution.latencyMs)
    ? Math.max(0, Math.round(execution.latencyMs))
    : null;

  return {
    status: result.status,
    ...(typeof result.message === 'string' ? { message: result.message } : {}),
    questions: (result.questions ?? []).map((question) => ({
      questionText: question.questionText,
      rationale: question.rationale,
      priority: question.priority,
      citations: (question.citations ?? [])
        .filter((citation) => citation && typeof citation === 'object')
        .map((citation) => ({
          sourceKind: citation.sourceKind,
          sourceId: citation.sourceId,
          sourceRevision: citation.sourceRevision,
          evidenceId: citation.evidenceId,
          evidenceRevision: citation.evidenceRevision,
          locator: {
            kind: citation.locator?.kind,
            ...(citation.locator?.recordId ? { recordId: citation.locator.recordId } : {}),
            ...(citation.locator?.memoryId ? { memoryId: citation.locator.memoryId } : {}),
          },
          effectiveTime: citation.effectiveTime,
          reviewState: citation.reviewState,
          content: citation.content,
        })),
    })),
    execution: { providerMode, latencyMs, tokenUsage },
  };
}

module.exports = {
  PROJECT_NAME,
  disableAmbientTracing,
  getLangSmithApiKey,
  isLangSmithUploadEnabled,
  toLangSmithExample,
  toLangSmithOutput,
};
