import { runOwnedLiveGraphTool } from '@orot/agent-runtime';
import { ragConversationTask } from '../../../ragConversation/task';
import { fixture as ordinary } from '../../../ragConversation/testSupport/conversationEnvelopeFixtures';
import { fixture as protectedFixture } from '../../../voiceConversation/testSupport/liveResponsesProtectedFixture';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { bindOwnedLiveConversationInvocation } from '../../../voiceConversation/ownedLiveConversationInvocation';

const owner = {
  callId: 'call',
  sessionId: 'session',
  delegationId: 'delegation',
  responseId: 'response',
};

test.each(['current', 'protection-revoked', 'selection-revoked'] as const)(
  'stock graph and protected read capture require the exact live owner at each handoff: %s',
  async phase => {
    const local = await protectedFixture();
    try {
      const data = await local.openData();
      const registry = new LocalEvidenceReferenceRegistry();
      const chat = ordinary();
      let active = true;
      let permitted = true;
      const current = () => active;
      const read = jest.fn(
        async (...args: Parameters<typeof data.readHealthContext>) => {
          const result = await data.readHealthContext(...args);
          if (phase === 'selection-revoked') permitted = false;
          return result;
        },
      );
      const beforeRead = jest.fn(async () => {
        await Promise.resolve();
        if (phase === 'protection-revoked') active = false;
        return true;
      });
      const didRead = jest.fn();
      const tools = bindOwnedLiveConversationInvocation({
        data: { ...data, readHealthContext: read },
        registry,
        current,
        permits: tool => permitted && tool.id === 'local-health-context',
        beforeRead,
        didRead,
      });
      expect(tools?.map(tool => tool.id)).toEqual(['local-health-context']);
      const call = {
        ...owner,
        challengeId: 'challenge',
        toolCallId: 'tool',
        name: 'local-health-context',
        args: JSON.stringify({ topics: ['measurements'], days: 7 }),
      };
      const result = await runOwnedLiveGraphTool({
        workflow: {
          ...chat.options.workflow,
          request: '',
          task: ragConversationTask,
          initialEvidence: { items: [], coverage: [], conflicts: [] },
          execution: {
            ...chat.options.workflow.execution,
            allowedScope: { sourceKinds: ['personal_record'] },
          },
          provider: {
            ...chat.options.workflow.provider,
            capabilities: {
              ...chat.options.workflow.provider.capabilities,
              toolCalling: true,
            },
          },
          tools: tools ?? [],
          revalidateEvidence: (references, signal) =>
            registry.revalidateEvidence(references, signal),
        },
        owner,
        current,
        utterance: { kind: 'context-free', current },
        signal: new AbortController().signal,
        nativeChallengeCurrent: selected =>
          selected.challengeId === call.challengeId,
        select: async () => ({ owner, calls: [call] }),
      });

      expect(beforeRead).toHaveBeenCalledTimes(1);
      if (phase === 'protection-revoked') expect(read).not.toHaveBeenCalled();
      else expect(read).toHaveBeenCalled();
      expect(didRead).toHaveBeenCalledTimes(phase === 'current' ? 1 : 0);
      if (phase === 'current')
        expect(result).toMatchObject({
          status: 'evidence_references',
          result: { contentLocation: 'current_task_messages' },
        });
      else expect(result).toBeUndefined();
      expect(chat.generate).not.toHaveBeenCalled();
    } finally {
      local.close();
    }
  },
);
