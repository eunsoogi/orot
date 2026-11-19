import { chatGPTCredentialMutation } from '../../../providers/chatGPTConsentIdentity';
import { nativeChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import { resolveSelectedAiProvider } from '../provider';

const saved = {
  providerId: 'chatgpt-plan:synthetic:model-a',
  modelId: 'model-a',
};
const eligible = {
  issuedClientID: 'synthetic',
  requiresSignIn: false,
  hasDirectPlanAccess: true,
};
const apple = createAppleSelectionOption('available');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settled = () => new Promise<void>(resolve => setImmediate(resolve));

function setup() {
  const selected = deferred<typeof saved>();
  const availability = deferred<typeof apple>();
  jest.spyOn(providerSelectionStore, 'load').mockReturnValue(selected.promise);
  const accounts = jest
    .spyOn(nativeChatGPTSelectionServices, 'listAccounts')
    .mockResolvedValue([eligible]);
  const models = jest
    .spyOn(nativeChatGPTSelectionServices, 'listModels')
    .mockResolvedValue({
      ok: true,
      value: [
        { id: 'model-a', slug: 'model-a', displayName: 'Synthetic model' },
      ],
    });
  const loadAppleOption = jest.fn(() => availability.promise);
  const read = () => resolveSelectedAiProvider({ loadAppleOption }, true);
  return { selected, availability, accounts, models, loadAppleOption, read };
}

afterEach(() => jest.restoreAllMocks());

test('starts independent local reads only after the stored choice and gates the exact catalog', async () => {
  const f = setup();
  const localAccounts = deferred<(typeof eligible)[]>();
  f.accounts.mockReturnValueOnce(localAccounts.promise);
  const result = f.read();
  expect(f.loadAppleOption).not.toHaveBeenCalled();
  expect(f.accounts).not.toHaveBeenCalled();
  f.selected.resolve(saved);
  await settled();
  expect(f.loadAppleOption).toHaveBeenCalledTimes(1);
  expect(f.accounts).toHaveBeenCalledTimes(1);
  localAccounts.resolve([eligible]);
  await settled();
  expect(f.models).not.toHaveBeenCalled();
  f.availability.resolve(apple);
  await expect(result).resolves.toMatchObject({
    status: 'ready',
    selection: saved,
  });
  expect(f.models).toHaveBeenCalledTimes(1);
  expect(f.models).toHaveBeenCalledWith('synthetic');
});

test('contains an early account failure when the availability gate also fails', async () => {
  const f = setup();
  const localAccounts = deferred<(typeof eligible)[]>();
  f.accounts.mockReturnValueOnce(localAccounts.promise);
  const result = f.read();
  f.selected.resolve(saved);
  await settled();
  f.availability.reject(new Error('Synthetic availability failure'));
  await expect(result).resolves.toEqual({ status: 'unavailable' });
  localAccounts.reject(new Error('Synthetic local failure'));
  await settled();
  expect(f.models).not.toHaveBeenCalled();
});

test('a failed early read gets the same serial account check as the previous path', async () => {
  const f = setup();
  f.accounts.mockRejectedValueOnce(
    new Error('Synthetic temporary local failure'),
  );
  const result = f.read();
  f.selected.resolve(saved);
  await settled();
  expect(f.accounts).toHaveBeenCalledTimes(1);
  expect(f.models).not.toHaveBeenCalled();
  f.availability.resolve(apple);
  await expect(result).resolves.toMatchObject({
    status: 'ready',
    selection: saved,
  });
  expect(f.accounts).toHaveBeenCalledTimes(2);
});

test('credential recovery invalidates the earlier account observation before remote admission', async () => {
  const f = setup();
  f.accounts.mockResolvedValueOnce([eligible]).mockResolvedValueOnce([
    { ...eligible, requiresSignIn: true },
    { ...eligible, issuedClientID: 'different-account' },
  ]);
  const result = f.read();
  f.selected.resolve(saved);
  await settled();
  const restore = chatGPTCredentialMutation.begin();
  restore();
  f.availability.resolve(apple);
  await expect(result).resolves.toEqual({ status: 'unavailable' });
  expect(f.accounts).toHaveBeenCalledTimes(2);
  expect(f.models).not.toHaveBeenCalled();
});

test('a changed saved selection cannot reuse the earlier positive account read', async () => {
  const f = setup();
  let unchanged = true;
  jest
    .spyOn(providerSelectionStore, 'liveWitness')
    .mockReturnValue(() => unchanged);
  f.accounts.mockResolvedValueOnce([eligible]).mockResolvedValueOnce([]);
  const result = f.read();
  f.selected.resolve(saved);
  await settled();
  unchanged = false;
  f.availability.resolve(apple);
  await expect(result).resolves.toEqual({ status: 'unavailable' });
  expect(f.accounts).toHaveBeenCalledTimes(2);
  expect(f.models).not.toHaveBeenCalled();
});

test('a native catalog authorization failure still withholds the selection', async () => {
  const f = setup();
  f.models.mockRejectedValueOnce(
    new Error('Synthetic native authorization failure'),
  );
  const result = f.read();
  f.selected.resolve(saved);
  f.availability.resolve(apple);
  await expect(result).resolves.toEqual({ status: 'unavailable' });
  expect(f.models).toHaveBeenCalledWith('synthetic');
});

test('injected account services retain their original serial ownership and plan gate', async () => {
  const f = setup();
  const accounts = jest.fn(async () => [
    { ...eligible, hasDirectPlanAccess: false },
  ]);
  const result = resolveSelectedAiProvider(
    {
      loadAppleOption: f.loadAppleOption,
      chatGPTServices: {
        ...nativeChatGPTSelectionServices,
        listAccounts: accounts,
      },
    },
    true,
  );
  f.selected.resolve(saved);
  await settled();
  expect(accounts).not.toHaveBeenCalled();
  f.availability.resolve(apple);
  await expect(result).resolves.toEqual({ status: 'unavailable' });
  expect(accounts).toHaveBeenCalledTimes(1);
  expect(f.models).not.toHaveBeenCalled();
});
