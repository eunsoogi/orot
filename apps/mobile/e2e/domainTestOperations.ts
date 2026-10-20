import { runStorageProbe } from '../src/storage/e2eProbe';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import { runGraphIntegrationProbe } from './graphIntegrationProbe';
import { withMockAppleModel } from './appleModelMockBridge';
import { appleModelMockScript } from './appleModelMockFixtures';

/** Each operation keeps its original domain assertions; no UI status is treated as a native result. */
export async function runDomainTestOperation(
  operation: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    parameters.fixtureIdentifier !== undefined &&
    typeof parameters.fixtureIdentifier !== 'string'
  )
    throw new Error('A memory fixture identifier must be a string');
  const memoryIdentifier =
    typeof parameters.fixtureIdentifier === 'string'
      ? parameters.fixtureIdentifier
      : undefined;
  const storageIdentifier =
    typeof parameters.storageIdentifier === 'string'
      ? parameters.storageIdentifier
      : undefined;
  switch (operation) {
    case 'ai-scale-calendar': {
      const { measureScaleCalendar } = await import('./aiScaleCalendar');
      const runs = [];
      for (const count of [1000, 10000, 50000])
        runs.push(await measureScaleCalendar(count));
      runs.push(await measureScaleCalendar(50000, true));
      return { synthetic: true, scriptedModel: true, runs };
    }
    case 'ai-scale': {
      const { runAiScaleTestOperation } =
        await import('./aiScaleTestOperation');
      return runAiScaleTestOperation(parameters.fixtureIdentifier);
    }
    case 'checkpoint-persistence': {
      const { runCheckpointPersistenceOperation } =
        await import('./checkpointPersistenceOperation');
      return runCheckpointPersistenceOperation(
        parameters.mode,
        parameters.fixtureIdentifier,
      );
    }
    case 'recording-persistence-seed':
    case 'recording-persistence-read': {
      const { seedRecordingPersistence, readRecordingPersistence } =
        await import('./recordingPersistenceTestOperation');
      return operation === 'recording-persistence-seed'
        ? seedRecordingPersistence()
        : readRecordingPersistence(parameters);
    }
    case 'connection':
      return { connected: true };
    case 'fixture-isolation': {
      const { runFixtureIsolationTestOperation } =
        await import('./fixtureIsolationTestOperation');
      return runFixtureIsolationTestOperation(
        parameters.mode,
        parameters.token,
      );
    }
    case 'health-pagination': {
      const { runHealthPaginationTestOperation } =
        await import('./healthPaginationTestOperation');
      return runHealthPaginationTestOperation(parameters.fixtureIdentifier);
    }
    case 'health-context': {
      const { runHealthContextTestOperation } =
        await import('./healthContextTestOperation');
      return runHealthContextTestOperation(parameters.fixtureIdentifier);
    }
    case 'health-context-persistence': {
      const { runHealthContextPersistenceTestOperation } =
        await import('./healthContextPersistenceTestOperation');
      return runHealthContextPersistenceTestOperation(
        parameters.fixtureIdentifier,
      );
    }
    case 'automatic-speech-readback':
    case 'automatic-speech-cleanup': {
      const {
        readAutomaticSpeechAfterRestart,
        cleanupAutomaticSpeechAfterRestart,
      } = await import('./automaticSpeechReadbackOperation');
      return operation === 'automatic-speech-readback'
        ? readAutomaticSpeechAfterRestart(parameters.sourceId)
        : cleanupAutomaticSpeechAfterRestart(parameters.sourceId);
    }
    case 'render-application': {
      const { renderApplicationForTest } =
        await import('./testApplicationRenderer');
      return renderApplicationForTest();
    }
    case 'graph':
      return runGraphIntegrationProbe();
    case 'local-query': {
      const { runLocalQueryIntegrationProbe } =
        require('./localRecordQueryProbe') as typeof import('./localRecordQueryProbe');
      if (typeof parameters.queryIdentifier !== 'string')
        throw new Error(
          'Native local query tests require an isolated fixture identifier',
        );
      return {
        summary: await runLocalQueryIntegrationProbe(
          parameters.queryIdentifier,
        ),
        synthetic: true,
      };
    }
    case 'apple-model': {
      const { runAppleFoundationModelsProbe } =
        require('./appleFoundationModelsProbe') as typeof import('./appleFoundationModelsProbe');
      const { validateVisitQuestionText } =
        require('./appleFoundationModelsProbeValidation') as typeof import('./appleFoundationModelsProbeValidation');
      const result = await withMockAppleModel(
        appleModelMockScript(operation),
        runAppleFoundationModelsProbe,
      );
      if (result.availability === 'available') {
        // Keep the original available-branch assertions, including exact text and synthetic source preservation.
        if (result.sourceIdPreserved !== 'passed')
          throw new Error(
            'Generated output did not preserve the synthetic source ID',
          );
        if (
          validateVisitQuestionText(result.questionText) !== result.questionText
        )
          throw new Error('Generated question changed during validation');
      }
      const { runAppleModelMockBridgeProbe } =
        require('./appleModelMockBridgeProbe') as typeof import('./appleModelMockBridgeProbe');
      return { ...result, bridge: await runAppleModelMockBridgeProbe() };
    }
    case 'apple-workflow': {
      const { runAppleWorkflowProbe } =
        require('./appleWorkflowProbe') as typeof import('./appleWorkflowProbe');
      // Shipping workflows and deadlines remain intact; only raw Foundation Models responses are scripted.
      return withMockAppleModel(appleModelMockScript(operation), () =>
        runAppleWorkflowProbe(() => {}),
      );
    }
    case 'calendar-classification': {
      const { runCalendarClassificationTestOperation } =
        require('./calendarClassificationTestOperation') as typeof import('./calendarClassificationTestOperation');
      return withMockAppleModel(
        appleModelMockScript(operation),
        runCalendarClassificationTestOperation,
      );
    }
    case 'rag-workflow': {
      const { runRagWorkflowProbe } =
        require('./ragWorkflowProbe') as typeof import('./ragWorkflowProbe');
      // Public-query authorization and real Europe PMC retrieval remain owned by the probe; shipping workflow budgets are unchanged.
      return {
        ...(await withMockAppleModel(appleModelMockScript(operation), () =>
          runRagWorkflowProbe(() => {}, new AbortController().signal),
        )),
      };
    }
    case 'local-e5': {
      if (parameters.mode !== 'fresh' && parameters.mode !== 'restart')
        throw new Error('Native local model tests require a valid E5 mode');
      const { runLocalE5EmbeddingProbe } =
        require('./localE5EmbeddingProbe') as typeof import('./localE5EmbeddingProbe');
      // Nest native measurements so the command transport's Hermes runtime label cannot overwrite memory and inference metrics.
      return {
        result: await runLocalE5EmbeddingProbe(parameters.mode),
        syntheticCorpus: true,
      };
    }
    case 'hybrid-retrieval': {
      const { runHybridRetrievalProbe } =
        require('./hybridRetrievalProbe') as typeof import('./hybridRetrievalProbe');
      return {
        result: await runHybridRetrievalProbe(),
        syntheticCorpus: true,
      };
    }
    case 'openai-provider': {
      const { runOpenAIProviderIntegrationProbe } =
        require('./openaiProviderProbe') as typeof import('./openaiProviderProbe');
      await runOpenAIProviderIntegrationProbe();
      return {
        synthetic: true,
        realAccount: 'unverified',
        assertions: 'catalog-stream-rate-limit-cancellation',
      };
    }
    case 'openai-tools': {
      const { runOpenAIToolsIntegrationProbe } =
        require('./openaiToolsProviderProbe') as typeof import('./openaiToolsProviderProbe');
      await runOpenAIToolsIntegrationProbe();
      return {
        synthetic: true,
        realAccount: 'unverified',
        assertions: 'definitions-stream-tool-result-hosted-rejection',
      };
    }
    case 'healthkit': {
      const { runHealthKitIntegrationProbe } = await import('./healthkitProbe');
      return { summary: await runHealthKitIntegrationProbe(), synthetic: true };
    }
    case 'sleep-import': {
      const { runSleepIntegrationProbe } = await import('./sleepImportProbe');
      return { summary: await runSleepIntegrationProbe(), synthetic: true };
    }
    case 'storage-create':
      await runStorageProbe('fresh', storageIdentifier);
      return { encrypted: true, wrongKeyRejected: true, recordsVerified: true };
    case 'storage-read':
      await runStorageProbe('restart', storageIdentifier);
      return { sourceAndEvidenceRestored: true, ragChunksVerified: true };
    case 'memory-create':
      await runAgentMemoryProbe('fresh', memoryIdentifier);
      return { synthetic: true, persisted: true, networkDisabled: true };
    case 'memory-delete':
      await runAgentMemoryProbe('delete', memoryIdentifier);
      return { removed: true, networkDisabled: true };
    case 'memory-restart':
      await runAgentMemoryProbe('restart', memoryIdentifier);
      return {
        restoredBeforeDeletion: true,
        removed: true,
        networkDisabled: true,
      };
    case 'memory-tombstone':
      await runAgentMemoryProbe('tombstone-restart', memoryIdentifier);
      return { tombstoneVerified: true, networkDisabled: true };
    case 'memory-verify-deletion':
      await runAgentMemoryProbe('verify-deletion', memoryIdentifier);
      return { absentFromMemoryAndSearch: true, networkDisabled: true };
    default:
      throw new Error('Unknown iOS test operation: ' + operation);
  }
}
