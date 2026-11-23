import {
  runMultiAgentWorkflow,
  type ConversationToolEvent,
  type OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import {
  healthContextFixture,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import {
  apple,
  localData,
  memoryTransportFixture,
  selectionStore,
} from '../featureServiceFixtures';
import { requireSelectedAi, resolveSelectedAiProvider } from '../provider';
import { createHealthSummaryService } from '../healthSummaryService';
import { buildMemoryEvidence } from '../memoryEvidence';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../../../agent/execution/settingsConsentCatalog';
import { settingsGrantCoversRequest } from '../../../agent/execution/settingsConsentGrant';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

test('the typed Health Summary has period evidence but does not reinterpret authorized or local-only notes as period evidence', async () => {
  const f = await healthContextFixture();
  try {
    const storage = new SqlCipherAgentMemoryStorage(f.database);
    const mixed = memoryTransportFixture().records;
    for (const memory of mixed) await storage.append(memory);
    const loadMemoryRecords = jest.fn(() => storage.listRecords());
    const records = await loadMemoryRecords();
    expect(records.map(item => item.text).sort()).toEqual(
      mixed.map(item => item.text).sort(),
    );
    // The existing evidence layer recognizes only the allowed fixture note, even before ranks or dispatch.
    const eligible = await buildMemoryEvidence({
      records,
      storage,
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(eligible.items.map(item => item.content)).toEqual([mixed[0]!.text]);
    loadMemoryRecords.mockClear();

    const dispatches: unknown[] = [];
    const events: ConversationToolEvent[] = [];
    const runner: typeof runDiseaseHypothesisAnalysis = async (
      options,
      _inventory,
      invocation,
      _resolve,
      task,
    ) => {
      expect(options.tools.map(tool => tool.id)).toEqual([
        'local-health-context',
      ]);
      const provider = {
        ...options.provider,
        capabilities: {
          ...options.provider.capabilities,
          toolCalling: true,
          structuredOutput: true,
        },
        async generate(
          request: Parameters<typeof options.provider.generate>[0],
        ) {
          dispatches.push(request);
          return dispatches.length === 1
            ? providerSuccess({
                text: '',
                toolCalls: [
                  {
                    id: 'period',
                    name: 'local-health-context',
                    arguments: { window, topics: ['measurements'] },
                  },
                ],
                finishReason: 'tool_calls' as const,
              })
            : providerSuccess({
                text: '{}',
                toolCalls: [],
                finishReason: 'complete' as const,
              });
        },
      };
      const result = await runMultiAgentWorkflow(
        { ...options, provider, task: task! },
        invocation,
      );
      return { status: 'workflow', result };
    };
    const selected = requireSelectedAi(
      await resolveSelectedAiProvider({
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      }),
    );
    const identity = {
      providerId: selected.provider.id,
      modelId: selected.modelId,
      recipient: 'synthetic-summary-recipient',
      authorityGeneration: 'synthetic-owner',
      credentialEpoch: 'synthetic-epoch',
    };
    const authorizations: OutboundProcessingRequest[] = [];
    let openingStage = 0;
    const opening = jest.fn(async () =>
      providerSuccess({
        text: ++openingStage === 1 ? '기록을 살펴볼게요.' : 'ALLOW',
        toolCalls: [],
        finishReason: 'complete' as const,
      }),
    );
    const service = createHealthSummaryService({
      selectedAi: async () => ({
        ...selected,
        provider: { ...selected.provider, generate: opening },
        recipient: identity.recipient,
        remoteProcessing: true,
      }),
      consent: {
        async authorize(request) {
          authorizations.push(request);
          return settingsGrantCoversRequest(
            {
              version: 1,
              catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
              identity,
              permissions: [
                {
                  purpose: 'symptom_summary',
                  policyVersion: 'local-records-v1',
                  dataCategories: ['health_records', 'conversation'],
                  sourceKinds: ['personal_record'],
                },
              ],
            },
            identity,
            SETTINGS_CONSENT_CATALOG_VERSION,
            request,
          )
            ? 'authorized'
            : 'renewal_required';
        },
      },
      loadData: async () => ({
        ...localData([]).data,
        memoryStorage: storage,
        loadMemoryRecords,
        readHealthContext: f.read,
      }),
      registry: f.registry,
      runner,
      storage: async () => f.storage,
      createRunId: () => 'synthetic-mixed-health-summary',
    });
    await service(
      { question: '선택한 기간의 합성 기록을 정리해 줘.', window },
      new AbortController().signal,
      {
        onToolEvent: event => events.push(event),
        onTaskStreamEvent: jest.fn(),
      },
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'completed' }),
      ]),
    );
    expect(dispatches.length).toBeGreaterThan(1);
    expect(opening).toHaveBeenCalledTimes(2);
    expect(authorizations.length).toBeGreaterThan(1);
    for (const request of authorizations) {
      expect(request.consentScope?.dataCategories).toEqual([
        'health_records',
        'conversation',
      ]);
      expect(request.allowedScope.sourceKinds).toEqual(['personal_record']);
    }
    for (const memory of mixed)
      expect(JSON.stringify(dispatches)).not.toContain(memory.text);
    expect(loadMemoryRecords).not.toHaveBeenCalled();
    // The SQLite corpus still has both original records; neither was auto-written by the summary.
    expect((await storage.listRecords()).map(item => item.id).sort()).toEqual(
      mixed.map(item => item.id).sort(),
    );
  } finally {
    f.close();
  }
});
