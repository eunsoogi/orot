import { appleFoundationModelsProvider } from '../src/providers/apple';
import { localE5NativeBackend } from '../src/rag/localE5NativeBackend';
import { runDiseaseHypothesisAnalysis } from '../src/diseaseHypotheses/task';
import { runRagConversationTurn } from '../src/ragConversation/service';
import { defaultVisitQuestionRouteOperations } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';

export const issue191Services: AiFeatureServiceDependencies = {
  diseaseRunner: async (...args) => {
    const result = await runDiseaseHypothesisAnalysis(...args);
    logParts('DISEASE', JSON.stringify(result));
    return result;
  },
  ragRunner: async (...args) => {
    const result = await runRagConversationTurn(...args);
    logParts('RAG', JSON.stringify(result));
    return result;
  },
};

export const issue191VisitOperations = {
  ...defaultVisitQuestionRouteOperations,
  generate: async (
    ...args: Parameters<typeof defaultVisitQuestionRouteOperations.generate>
  ) => {
    const result = await defaultVisitQuestionRouteOperations.generate(...args);
    logParts('VISIT', JSON.stringify(result));
    return result;
  },
};

let installed = false;

/** Diagnostics apply only to the synthetic entry and never replace native results. */
export function installIssue191Diagnostics() {
  if (installed) return;
  installed = true;
  const generate = appleFoundationModelsProvider.generate.bind(
    appleFoundationModelsProvider,
  );
  appleFoundationModelsProvider.generate = async (request, options) => {
    const started = Date.now();
    for (const message of request.messages) {
      if (message.role === 'user') logParts('REQUEST', JSON.stringify(message));
    }
    const result = await generate(request, options);
    logParts(
      'PROVIDER',
      JSON.stringify({ elapsedMs: Date.now() - started, result }),
    );
    return result;
  };
  const embed = localE5NativeBackend.embedBatch.bind(localE5NativeBackend);
  localE5NativeBackend.embedBatch = async (input, role, requestId) => {
    const started = Date.now();
    try {
      return await embed(input, role, requestId);
    } finally {
      console.log(
        'ISSUE191_NATIVE_EMBED ' +
          JSON.stringify({
            elapsedMs: Date.now() - started,
            count: input.length,
            role,
          }),
      );
    }
  };
}

/** Unified logging truncates long lines; numbered chunks retain the synthetic schema evidence. */
function logParts(kind: string, text: string) {
  for (let offset = 0; offset < text.length; offset += 500) {
    console.log(
      `ISSUE191_${kind}_${offset} ` + text.slice(offset, offset + 500),
    );
  }
}
