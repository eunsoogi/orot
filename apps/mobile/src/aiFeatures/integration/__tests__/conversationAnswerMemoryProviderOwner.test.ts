import {
  conversationAnswerMemoryProviderOwner,
  observeAnswerMemoryProviderOwner,
} from '../conversationAnswerMemoryProviderOwner';

type Args = Parameters<typeof conversationAnswerMemoryProviderOwner>;
const providerId = 'chatgpt-plan:synthetic';
const modelId = 'synthetic-model';
const selected = {
  status: 'ready',
  remoteProcessing: true,
  modelId,
  provider: { id: providerId, capabilities: { toolCalling: true } },
} as unknown as Args[0];

function fixture() {
  let live = true;
  let retire: () => void = () => {};
  const unwatch = jest.fn();
  const owner = {
    providerId,
    modelId,
    current: () => live,
    recheck: jest.fn(async () => true),
    watch(listener: () => void) {
      retire = listener;
      return unwatch;
    },
  };
  return {
    owner,
    unwatch,
    setLive: (value: boolean) => {
      live = value;
    },
    retire: () => retire(),
  };
}

it('requires the live native plan account/model and does not absorb local-only or voice turns', () => {
  const { owner, setLive } = fixture();
  expect(
    conversationAnswerMemoryProviderOwner(selected, {
      templateProposalOwner: owner,
    }),
  ).toBe(owner);
  expect(
    conversationAnswerMemoryProviderOwner(selected, {
      templateProposalOwner: owner,
      protectedLocalInput: true,
    }),
  ).toBeUndefined();
  expect(
    conversationAnswerMemoryProviderOwner(selected, {
      templateProposalOwner: owner,
      expectedVoiceSelection: { providerId, modelId },
    }),
  ).toBeUndefined();
  expect(
    conversationAnswerMemoryProviderOwner(
      { ...selected, modelId: 'different-model' },
      { templateProposalOwner: owner },
    ),
  ).toBeUndefined();
  expect(
    conversationAnswerMemoryProviderOwner(
      { ...selected, provider: { ...selected.provider, id: 'openai-api' } },
      { templateProposalOwner: owner },
    ),
  ).toBeUndefined();
  setLive(false);
  expect(
    conversationAnswerMemoryProviderOwner(selected, {
      templateProposalOwner: owner,
    }),
  ).toBeUndefined();
  expect(owner.recheck).not.toHaveBeenCalled();
});

it('an inactive-and-return owner cannot revive the same pending confirmation', async () => {
  const { owner, unwatch, setLive, retire } = fixture();
  let settled: (result: boolean) => void = () => {};
  owner.recheck.mockImplementationOnce(
    () =>
      new Promise<boolean>(resolve => {
        settled = resolve;
      }),
  );
  const signal = new AbortController().signal;
  const guard = observeAnswerMemoryProviderOwner(owner, signal);
  const pending = guard.recheck();
  setLive(false);
  retire();
  setLive(true);
  settled(true);
  await expect(pending).resolves.toBe(false);
  expect(guard.isCurrent()).toBe(false);
  await expect(guard.recheck()).resolves.toBe(false);
  expect(unwatch).toHaveBeenCalledTimes(1);
  guard.dispose();
  expect(unwatch).toHaveBeenCalledTimes(1);
});
