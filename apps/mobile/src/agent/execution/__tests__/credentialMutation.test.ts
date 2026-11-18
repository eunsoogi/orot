import { createCredentialMutationOwner } from '../credentialMutation';

test('queued credential mutation immediately invalidates requests and failure never revives witnesses', () => {
  const owner = createCredentialMutationOwner();
  const original = owner.capture()!;
  const changed = jest.fn();
  const stop = owner.subscribe(changed);
  const finishFirst = owner.begin();
  expect(original()).toBe(false);
  expect(owner.capture()).toBeNull();
  const finishSecond = owner.begin();
  finishFirst();
  finishFirst();
  expect(owner.capture()).toBeNull();
  finishSecond();
  expect(original()).toBe(false);
  expect(owner.capture()?.()).toBe(true);
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  owner.begin()();
  expect(changed).toHaveBeenCalledTimes(2);
});

test('unrelated credential owners remain independently usable', () => {
  const api = createCredentialMutationOwner();
  const chat = createCredentialMutationOwner();
  const chatCurrent = chat.capture()!;
  api.begin();
  expect(chatCurrent()).toBe(true);
});
