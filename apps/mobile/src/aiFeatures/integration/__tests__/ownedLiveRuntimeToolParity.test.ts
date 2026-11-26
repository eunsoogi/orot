import {
  runOwnedLiveGraphTool,
  type EvidenceSearchTool,
} from '@orot/agent-runtime';
import { withNativeTools } from '../../../../../../packages/agent-runtime/src/multiAgent/nativeTools';
import { initialState } from '../../../../../../packages/agent-runtime/src/multiAgent/workflowSupport';
import { ragConversationTask } from '../../../ragConversation/task';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
import { conversationExternalEvidence } from '../../../conversationTools/conversationExternalEvidence';
import { createConversationToolBundle } from '../../../conversationTools/conversationToolBundle';
import { conversationHistoryAction } from '../conversationHistoryAction';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { executionOptions } from '../featureServiceExecution';
import { localData } from '../featureServiceFixtures';
import { bindOwnedLiveConversationInvocation } from '../../../voiceConversation/ownedLiveConversationInvocation';
import { createResearchInputTracker } from '../researchInputTracker';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

const toolName = {
  health: 'local-health-context',
  summary: 'local-generated-artifacts',
  selector: 'local-saved-recording-transcript',
};
const owner = {
  callId: 'synthetic-call',
  sessionId: 'synthetic-session',
  delegationId: 'synthetic-delegation',
  responseId: 'synthetic-response',
};
function fixture(selector: boolean) {
  const { selected, consent, search } = publicEvidenceFixture();
  const noIO = jest.fn(async (): Promise<never> => {
    throw new Error(
      'Descriptor selection must not read, write or use a provider',
    );
  });
  const provider = {
    ...selected.provider,
    capabilities: { ...selected.provider.capabilities, toolCalling: true },
    generate: noIO,
  };
  const data = {
    ...localData([]).data,
    readHealthContext: noIO,
    summaryArtifactDiscovery: noIO,
    saveConversationHistory: noIO,
  };
  const observer: RagConversationObserver = {
    inputOrigin: 'composer',
    protectedLocalInput: true,
    ...(selector ? { recordingClarification: { stage: noIO } } : {}),
  };
  const registry = new LocalEvidenceReferenceRegistry();
  const researchInputs = createResearchInputTracker(
    registry,
    data,
    'synthetic',
  );
  const external = conversationExternalEvidence({
    selected,
    consent,
    observer,
    queryConsent: { authorize: noIO },
    externalEvidence: { search: noIO },
    loadLocalData: noIO,
    researchInputs,
  });
  const text = createConversationToolBundle({
    data,
    registry,
    observer,
    researchInputs,
    externalTools: external.tools,
    publicSearchSucceeded: true,
  }).tools;
  const beforeRead = jest.fn(async () => true);
  const actions = conversationHistoryAction({
    data,
    registry,
    observer,
    question: 'Synthetic request',
    admittedQuestions: [],
  });
  const workflow = (tools: readonly EvidenceSearchTool[]) => ({
    ...executionOptions({
      registry,
      selected: { ...selected, provider },
      operationRunId: 'synthetic-run',
      consent,
      tools,
      consentPurpose: 'record_conversation',
    }),
    request: 'Synthetic request',
    context: { previousConversation: [] },
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    task: ragConversationTask,
    actions,
  });
  return { data, registry, observer, text, workflow, noIO, beforeRead, search };
}

test.each([
  {
    selector: true,
    summary: true,
    names: [toolName.health, toolName.summary, toolName.selector],
  },
  {
    selector: false,
    summary: true,
    names: [toolName.health, toolName.summary],
  },
  {
    selector: true,
    summary: false,
    names: [toolName.health, toolName.selector],
  },
])('text and Live expose the same permitted manifest: $names', async row => {
  const f = fixture(row.selector);
  const allowed = new Set([
    toolName.health,
    toolName.selector,
    ...(row.summary ? [toolName.summary] : []),
  ]);
  const permits = ({ id }: Pick<EvidenceSearchTool, 'id'>) => allowed.has(id);
  const signal = new AbortController().signal;
  const textWorkflow = f.workflow(f.text.filter(permits));
  const state = { ...initialState(textWorkflow), modelCalls: 1 };
  const textRequest = withNativeTools(
    {
      options: textWorkflow,
      signal,
      timedOut: () => false,
      currentEvidence: textWorkflow.initialEvidence,
    },
    state,
    { messages: [] },
  );
  const expected = textRequest.tools?.map(
    ({ name, description, inputSchema }) => ({
      name,
      description,
      parameters: inputSchema,
    }),
  );
  expect(expected?.map(tool => tool.name)).toEqual(row.names);
  expect(textWorkflow.actions).toEqual([]);
  const liveTools = bindOwnedLiveConversationInvocation({
    data: f.data,
    registry: f.registry,
    observer: f.observer,
    current: () => true,
    permits,
    beforeRead: f.beforeRead,
  });
  expect(liveTools).toBeDefined();
  const select = jest.fn(
    async (
      _manifest: Parameters<
        Parameters<typeof runOwnedLiveGraphTool>[0]['select']
      >[0],
    ) => undefined,
  );
  await runOwnedLiveGraphTool({
    workflow: f.workflow(liveTools!),
    owner,
    signal,
    utterance: { kind: 'context-free', current: () => true },
    current: () => true,
    nativeChallengeCurrent: () => false,
    select,
  });
  expect(select).toHaveBeenCalledTimes(1);
  expect(select.mock.calls[0][0]).toEqual(expected);
  expect(f.noIO).not.toHaveBeenCalled();
  expect(f.beforeRead).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
});

test('a context-free Live turn cannot inherit the write admitted by an owned text turn', async () => {
  const f = fixture(false);
  const actions = conversationHistoryAction({
    data: f.data,
    registry: f.registry,
    observer: {
      ...f.observer,
      retentionSession: { id: 'synthetic-owner', version: 1 },
      retentionRequestId: 'synthetic-request',
      confirmHistorySave: f.noIO,
    },
    question: 'Synthetic request',
    admittedQuestions: [],
  });
  expect(actions.map(action => action.id)).toEqual([
    'save-past-health-history',
  ]);
  const select = jest.fn(async () => undefined);
  await runOwnedLiveGraphTool({
    workflow: { ...f.workflow(f.text), actions },
    owner,
    signal: new AbortController().signal,
    utterance: { kind: 'context-free', current: () => true },
    current: () => true,
    nativeChallengeCurrent: () => false,
    select,
  });
  expect(select).not.toHaveBeenCalled();
  expect(f.noIO).not.toHaveBeenCalled();
});
