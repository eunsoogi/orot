import type { EvidenceReference } from '@orot/agent-runtime';
import { isOwnedConversationToolReader } from '../../storage/conversationToolEventStorage';
import type { StoredConversationToolTurn } from '../../storage/conversationToolEventStorage';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import {
  prepareCaptureSources,
  type ConversationCaptureOwner,
} from './evidenceCaptureBatch';
import { fingerprint } from './evidenceUtils';
import { stableEvidenceReference } from './stableEvidenceReference';

type Input = {
  alias: EvidenceReference;
  sessionId: string;
  messageId: string;
  runId: string;
  callId: string;
  snapshot: unknown;
  storage: {
    readToolTurns(
      sessionId: string,
    ): Promise<readonly StoredConversationToolTurn[]>;
  };
  registry: LocalEvidenceReferenceRegistry;
};
const registryRead = LocalEvidenceReferenceRegistry.prototype.readSource;
const registryValidate =
  LocalEvidenceReferenceRegistry.prototype.revalidateEvidence;
const ownsRegistry = (registry: LocalEvidenceReferenceRegistry) =>
  registry.readSource === registryRead &&
  registry.revalidateEvidence === registryValidate;

type Registration = { input: Input; revision: string };
type Group = {
  owner: ConversationCaptureOwner;
  bindings: Map<string, Registration>;
};
const groups = new WeakMap<
  LocalEvidenceReferenceRegistry,
  WeakMap<object, Map<string, Group>>
>();

/** Issued only by the exact live tool binding over a factory-owned strict reader.
 * Grouping changes no SQL or rollback contract: both outer snapshots remain full
 * strict reads, while every inner callback and final source fence still executes. */
export function conversationToolCapture(input: Input) {
  const read = input.storage.readToolTurns;
  if (!isOwnedConversationToolReader(read) || !ownsRegistry(input.registry))
    return undefined;
  const stores =
    groups.get(input.registry) ?? new WeakMap<object, Map<string, Group>>();
  groups.set(input.registry, stores);
  const sessions = stores.get(input.storage) ?? new Map<string, Group>();
  stores.set(input.storage, sessions);
  let group = sessions.get(input.sessionId);
  if (!group) {
    const bindings = new Map<string, Registration>();
    const owned = () =>
      input.storage.readToolTurns === read && ownsRegistry(input.registry);
    const owner: ConversationCaptureOwner = {
      registry: input.registry,
      async prepare(requests, signal) {
        const selected = requests.map(request => {
          const binding = bindings.get(request.id);
          if (
            !binding ||
            binding.revision !== request.revision ||
            !request.tool ||
            stableEvidenceReference(request.tool.reference) !==
              stableEvidenceReference(binding.input.alias)
          )
            throw new Error('Invalid tool capture authority.');
          return binding;
        });
        if (!owned())
          return {
            results: requests.map(() => ({ status: 'unavailable' as const })),
            strict: requests.map((_, index) => index),
            finish: async () => !signal.aborted,
          };
        const current = async () => {
          if (signal.aborted || !owned()) return false;
          const turns = await input.storage.readToolTurns(input.sessionId);
          return (
            !signal.aborted &&
            owned() &&
            selected.every(binding => {
              const expected = binding.input;
              const turn = turns.find(
                item => item.messageId === expected.messageId,
              );
              const event = turn?.toolEvents.find(
                item =>
                  item.operationRunId === expected.runId &&
                  item.callId === expected.callId,
              );
              const lineage = turn?.lineages.find(
                item =>
                  item.runId === expected.runId &&
                  item.callId === expected.callId,
              );
              return (
                event &&
                lineage &&
                fingerprint({ event, lineage }) === binding.revision
              );
            })
          );
        };
        if (!(await current())) throw new Error('Tool capture source changed.');
        const inner = await prepareCaptureSources(
          input.registry,
          selected.map(binding => binding.input.alias),
          signal,
          { recheckFallback: true },
        );
        return {
          results: selected.map(
            binding =>
              inner.results.get(
                stableEvidenceReference(binding.input.alias),
              ) ?? { status: 'unavailable' as const },
          ),
          // Recheck original inner callbacks before the final strict call/session
          // snapshot. Neither a prior capture nor a disposed history scope grants validity.
          finish: async () =>
            !signal.aborted &&
            owned() &&
            (await inner.finish()) &&
            (await current()),
        };
      },
    };
    group = { owner, bindings };
    sessions.set(input.sessionId, group);
  }
  const id = String(group.bindings.size + 1);
  const revision = fingerprint(input.snapshot);
  group.bindings.set(id, {
    input: { ...input, alias: { ...input.alias } },
    revision,
  });
  return {
    owner: group.owner,
    identity: { id, revision, tool: { reference: input.alias } },
  };
}
