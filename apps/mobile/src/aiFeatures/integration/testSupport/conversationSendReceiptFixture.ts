import { mayHaveConversationCheckpoint } from '../../../ragConversation/conversationCheckpointInterruption';
import { installFixtureNativeSelection } from './conversationReceiptFixturePlatform';
import {
  providerSuccess,
  type LanguageModelProvider,
} from '@orot/model-runtime';
import type { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import type { createOpenAIPlanProvider } from '../../../providers/openai';
import { localData } from '../featureServiceFixtures';
import { createAiFeatureServices } from '../featureServices';

/** A request-local virtual clock injects controlled waits, not device/provider speed.
 * Only named phase durations and counts are retained; no payload or owner identifier.
 */
export function instantFixture() {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
      resolve = done;
    });
    return { promise, resolve };
  }
  function barrier() {
    const started = deferred();
    const released = deferred();
    return {
      entered: started.promise,
      hold() {
        started.resolve();
        return released.promise;
      },
      release: released.resolve,
    };
  }
  const receipt = deferred();
  let clock = 0;
  const marks = new Map<string, number>();
  const waiting = new Map<string, () => void>();
  return {
    catalog: { first: barrier(), second: barrier() },
    retention: barrier(),
    history: barrier(),
    authority: barrier(),
    provider: {
      started: barrier(),
      output: barrier(),
      forwarded: receipt.resolve,
      forwardedReceipt: receipt.promise,
    },
    final: barrier(),
    mark(name: string) {
      if (marks.has(name)) return;
      marks.set(name, clock);
      waiting.get(name)?.();
      waiting.delete(name);
    },
    until(name: string) {
      return marks.has(name)
        ? Promise.resolve()
        : new Promise<void>(done => {
            waiting.set(name, done);
          });
    },
    elapse(ms: number, next: ReturnType<typeof barrier>) {
      clock += ms;
      next.release();
    },
    relative: () => Object.fromEntries(marks),
  };
}

/** Fails fast with closed phase/count context instead of hanging on a missed transition. */
export async function receiptStageReached(
  name: string,
  work: Promise<void>,
  context: () => unknown,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Missing ${name}: ${JSON.stringify(context())}`)),
          500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Keep real selection/consent routing and swap only the remote boundaries. */
export function createReceiptTestApp(
  f: ReturnType<typeof instantFixture>,
  storage: ReturnType<typeof createConversationArtifactStorage>,
  installProvider: jest.MockedFunction<typeof createOpenAIPlanProvider>,
  warm: boolean,
) {
  const model = {
    id: 'fixture-model',
    slug: 'fixture-model',
    displayName: 'Fixture Model',
  };
  const other = {
    id: 'other-model',
    slug: 'other-model',
    displayName: 'Other Fixture Model',
  };
  let mode: 'ready' | 'catalog-removed' | 'account-removed' | 'model-changed' =
    'ready';
  const data = {
    ...localData([]).data,
    openConversationArtifactStorage: async () => storage,
  };
  let adapterCalls = 0;
  const generate = jest.fn<
    ReturnType<LanguageModelProvider['generate']>,
    Parameters<LanguageModelProvider['generate']>
  >(async (_request, options) => {
    const first = ++adapterCalls === 1;
    if (first) {
      f.mark('bridge_dispatch');
      await f.provider.started.hold();
      if (!options?.signal?.aborted) {
        f.mark('bridge_verified_start');
        options?.onResponseStarted?.();
        f.provider.forwarded();
      }
      await f.provider.output.hold();
    }
    return providerSuccess({
      text: first ? '요청하신 흐름을 살펴볼게요.' : 'ALLOW',
      toolCalls: [],
      finishReason: 'complete',
    });
  });
  installProvider.mockImplementation((account, descriptor) => ({
    kind: 'language-model',
    id: `chatgpt-plan:${account}:${descriptor.slug}`,
    displayName: descriptor.displayName,
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    generate,
  }));
  const listModels = jest.fn(async () => {
    const index = listModels.mock.calls.length;
    if (index === 2 && !warm) await f.catalog.first.hold();
    if (index === (warm ? 2 : 3)) await f.catalog.second.hold();
    return providerSuccess(
      mode === 'catalog-removed'
        ? []
        : mode === 'model-changed'
          ? [other]
          : [model],
    );
  });
  const account = {
    issuedClientID: 'fixture-account',
    hasDirectPlanAccess: true,
    requiresSignIn: false,
  };
  const listAccounts = jest.fn(async () =>
    mode === 'account-removed' ? [] : [account],
  );
  const loadAccountSummary = jest.fn(async (accountId: string) =>
    mode !== 'account-removed' && accountId === account.issuedClientID
      ? account
      : undefined,
  );
  const authorize = jest.fn(async () => {
    if (authorize.mock.calls.length === 1) await f.authority.hold();
    return 'authorized' as const;
  });
  const selectedAi = {
    selectionStore: {
      async load() {
        const chosen = mode === 'model-changed' ? other : model;
        return {
          providerId: `chatgpt-plan:fixture-account:${chosen.slug}`,
          modelId: chosen.slug,
        };
      },
      save: jest.fn(),
      clear: jest.fn(),
    },
    chatGPTServices: {
      listAccounts,
      listModels,
      signIn: jest.fn(),
      signOut: jest.fn(),
      cancelSignIn: jest.fn(),
    },
  };
  if (warm) installFixtureNativeSelection(selectedAi, loadAccountSummary);
  const services = createAiFeatureServices(
    { authorize },
    {
      ...(warm ? {} : { selectedAi }),
      loadLocalData: async () => data,
      externalEvidence: { search: async () => ({ status: 'empty' }) },
      ragRunner: async () => {
        await f.final.hold();
        return { status: 'answer', answer: 'Fixture finished', citations: [] };
      },
    },
  );
  return {
    services,
    listAccounts,
    assertAccountReads(inventories: number, exact: boolean) {
      expect(listAccounts).toHaveBeenCalledTimes(inventories);
      expect(loadAccountSummary.mock.calls).toEqual(
        exact ? [[account.issuedClientID]] : [],
      );
    },
    listModels,
    authorize,
    generate,
    async assertNoColdResume(lease: { id: string; version: number } | null) {
      if (!lease) throw new Error('Expected retained fixture owner');
      const interrupted = await storage.listInterruptedRequests(
        lease.id,
        lease.version,
      );
      expect(interrupted).toHaveLength(1);
      expect(
        interrupted.some(attempt =>
          mayHaveConversationCheckpoint(attempt.interruptionReason),
        ),
      ).toBe(false);
    },
    change(value: 'catalog-removed' | 'account-removed' | 'model-changed') {
      mode = value;
    },
  };
}
