import {
  acceptScopeAggregate,
  acceptScopeContext,
  acceptScopeEvidence,
  currentScopeGeneration,
  expectedEvent,
  rejectScope,
} from './visitQuestionScopeGuard';
import { audit } from './visitQuestionScopeInventory';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';
import {
  ensureHealthContextGeneration,
  readHealthContextGeneration,
} from '../src/healthEvidence/healthContext/generation';

/** Test-only loader preserves the production context and audits real tool results before release. */
export async function loadVisitQuestionsContext() {
  const token = currentScopeGeneration();
  const original = await import('../src/agent/visitQuestions/localContext');
  return {
    ...original,
    async prepareUpcomingVisitQuestionContext(
      input: Parameters<typeof original.prepareUpcomingVisitQuestionContext>[0],
    ) {
      const prepared =
        await original.prepareUpcomingVisitQuestionContext(input);
      if (prepared.status !== 'ready') return prepared;
      if (
        prepared.appointment.calendarEventIdentifier !== expectedEvent ||
        prepared.evidence.batch.items.length !== 0
      )
        rejectScope(token, 'context_mismatch');
      acceptScopeContext(token);
      const periodTool = prepared.healthContextTool;
      const snapshot = async (before: boolean) => {
        try {
          const database = await openLocalAgentMemoryDatabase();
          await database.transaction(ensureHealthContextGeneration);
          if (before) {
            const generation = await readHealthContextGeneration(database);
            return { generation, inventory: await audit(prepared.appointment) };
          }
          const inventory = await audit(prepared.appointment);
          return {
            inventory,
            generation: await readHealthContextGeneration(database),
          };
        } catch {
          return rejectScope(token, 'inventory_unavailable');
        }
      };
      return {
        ...prepared,
        async searchEvidence(
          ...args: Parameters<typeof prepared.searchEvidence>
        ) {
          const collection = await prepared.searchEvidence(...args);
          acceptScopeEvidence(token, collection);
          return collection;
        },
        ...(periodTool
          ? {
              healthContextTool: {
                ...periodTool,
                async search(request: Parameters<typeof periodTool.search>[0]) {
                  const before = await snapshot(true);
                  if (!before.inventory.ok)
                    rejectScope(token, 'inventory_mismatch');
                  const result = await periodTool.search(request);
                  const after = await snapshot(false);
                  if (!after.inventory.ok)
                    rejectScope(token, 'inventory_mismatch');
                  if (!('status' in result))
                    acceptScopeAggregate(
                      token,
                      result,
                      prepared.evidence.metadataByCitation,
                      before.generation.mutationGeneration ===
                        after.generation.mutationGeneration &&
                        before.generation.deletionGeneration ===
                          after.generation.deletionGeneration,
                    );
                  return result;
                },
              },
            }
          : {}),
      };
    },
  };
}
