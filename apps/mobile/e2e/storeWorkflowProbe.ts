import type {
  AgentMemoryService,
  AgentMemoryStoreView,
} from '@orot/agent-memory';
import { AGENT_MEMORY_NAMESPACE } from '@orot/agent-memory';
import type { Appointment } from '@orot/domain';
import { openLocalRecordQueryService } from '../src/agent/localRecordQuery';
import { prepareVisitQuestionContext } from '../src/agent/visitQuestions/evidenceService';
import { runVisitQuestionWorkflow } from '../src/agent/visitQuestions/workflow';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { createStoreWorkflowProvider } from './storeWorkflowProvider';
import { openLocalAgentMemory } from '../src/memory/localAgentMemory';
import { deterministicProvider } from '../src/memory/agentMemoryProbeFixtures';

/** Runs the app's production preparation, compiled graph, research tool and freshness policy. */
export async function probeStoreWorkflow(input: {
  store: AgentMemoryStoreView;
  memory: AgentMemoryService;
  fixture: string;
  text: string;
  memoryId: string;
  present: boolean;
}) {
  const repository = await openLocalStorage();
  const appointment: Appointment = {
    id: input.fixture + ':appointment',
    effectiveAt: '2035-06-02T09:00:00+09:00',
    recordedAt: '2035-05-01T00:00:00Z',
    ingestedAt: '2035-05-01T00:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status: 'scheduled',
    calendarEventIdentifier: input.fixture + ':calendar',
    calendarEventSnapshot: {
      title: '합성 외래 방문',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: '2035-06-02T00:00:00Z',
      isDetached: false,
      recurrenceRules: [],
    },
  };
  await repository.put('appointment', appointment);
  // Freshness must reopen after source deletion, never fail merely because an old engine was closed.
  const queryService = await openLocalRecordQueryService({
    async recall(query, options) {
      return (await openLocalAgentMemory(deterministicProvider)).recall(
        query,
        options,
      );
    },
  });
  const originalBatch = input.store.batch.bind(input.store);
  let searches = 0;
  input.store.batch = async operations => {
    for (const operation of operations) {
      if (
        !('namespacePrefix' in operation) ||
        JSON.stringify(operation.namespacePrefix) !==
          JSON.stringify(AGENT_MEMORY_NAMESPACE)
      )
        throw new Error(
          'The app graph attempted a Store write or a foreign namespace.',
        );
      searches += 1;
    }
    return originalBatch(operations);
  };
  try {
    const prepare = (withStore: boolean) =>
      prepareVisitQuestionContext({
        now: '2035-06-01T00:00:00Z',
        currentTime: () => '2035-06-01T00:00:00Z',
        maxEvidenceItems: 8,
        queryService,
        repository,
        ...(withStore ? { store: input.store } : {}),
        // A reviewed-memory tool must never fall through to clinical RAG or fabricated chunks.
        rag: {
          index: async () => {
            throw new Error('Unexpected RAG index');
          },
          search: async () => {
            throw new Error('Unexpected RAG search');
          },
        },
        buildChunks: async () => {
          throw new Error('Unexpected clinical chunk build');
        },
      });
    const run = async (withStore: boolean) => {
      const prepared = await prepare(withStore);
      if (
        prepared.status !== 'ready' ||
        prepared.appointment.id !== appointment.id
      )
        throw new Error(
          'The SQLCipher appointment was not selected by the app query service.',
        );
      let observedIds: string[] = [];
      const synthetic = createStoreWorkflowProvider(input.text, input.fixture);
      const selection = {
        providerId: synthetic.provider.id,
        modelId: 'synthetic',
      };
      const result = await runVisitQuestionWorkflow({
        prepared: {
          ...prepared,
          async searchEvidence(...args) {
            // LangGraph may wrap the host Store; the batch spy below proves its backend identity.
            if (Boolean(args[4]?.store) !== withStore)
              throw new Error(
                'Compiled graph did not forward the host Store capability.',
              );
            const evidence = await prepared.searchEvidence(...args);
            observedIds = evidence.batch.items.map(item => item.sourceId);
            return evidence;
          },
        },
        selection,
        providerOptions: [
          {
            provider: synthetic.provider,
            modelId: selection.modelId,
            displayName: 'Synthetic model',
            privacyBoundary: 'on-device',
            availability: { status: 'available' },
          },
        ],
      });
      return { prepared, result, observedIds, calls: synthetic.calls() };
    };
    const control = await run(false);
    if (
      control.result.status === 'ready' ||
      control.observedIds.length ||
      searches !== 0
    )
      throw new Error(
        'The app obtained reviewed-memory evidence without a graph Store.',
      );
    const actual = await run(true);
    if (
      searches < 1 ||
      !actual.calls ||
      actual.observedIds.includes(input.memoryId) !== input.present
    )
      throw new Error(
        `The compiled app graph did not read the expected persistent memory: searches=${searches}, calls=${actual.calls}, status=${actual.result.status}, matched=${actual.observedIds.includes(input.memoryId)}.`,
      );
    if (
      input.present &&
      (actual.result.status !== 'ready' ||
        actual.result.questions.some(
          question =>
            !question.citations.some(
              item =>
                item.sourceId === input.memoryId &&
                item.content.includes(input.text),
            ),
        ))
    )
      throw new Error(
        'The app did not restore real reviewed-memory citations.',
      );
    if (!input.present && actual.result.status === 'ready')
      throw new Error('The app generated questions from deleted memory.');
    const citations =
      actual.result.status === 'ready'
        ? actual.result.questions.flatMap(question => question.citations)
        : [];
    return {
      searches,
      providerCalls: actual.calls,
      async assertStale() {
        // Keep Calendar unchanged so only the changed memory can invalidate this citation.
        await repository.put('appointment', appointment);
        try {
          const selected =
            await queryService.queryNextConfirmedCalendarAppointment(
              '2035-06-01T00:00:00Z',
            );
          if (selected.appointment?.id !== appointment.id)
            throw new Error('Freshness appointment control failed.');
          if (
            !citations.length ||
            (await actual.prepared.revalidateEvidence(citations))
          )
            throw new Error(
              'The app accepted stale reviewed-memory citations.',
            );
        } finally {
          await repository.delete('appointment', appointment.id);
        }
      },
    };
  } finally {
    input.store.batch = originalBatch;
    await repository.delete('appointment', appointment.id);
  }
}
