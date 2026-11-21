import { createCredentialMutationOwner } from '../../../agent/execution/credentialMutation';
import { captureConversationSelectionWitness } from '../conversationSelectionWitness';

const provider = 'chatgpt-plan:synthetic-issued-client:model';

test('a same-id account relink cannot resurrect a captured witness', () => {
  const selected = createCredentialMutationOwner();
  const account = createCredentialMutationOwner();
  const bind = captureConversationSelectionWitness(selected, account);
  const witness = bind(provider)!;
  expect(witness()).toBe(true);
  const write = account.begin();
  expect(witness()).toBe(false);
  write();
  expect(bind(provider)).toBeNull();
  expect(witness()).toBe(false);
  expect(
    captureConversationSelectionWitness(selected, account)(provider)?.(),
  ).toBe(true);
});

test('a mutation spanning provider lookup remains unproven after it completes', () => {
  const selected = createCredentialMutationOwner();
  const account = createCredentialMutationOwner();
  const write = account.begin();
  const bind = captureConversationSelectionWitness(selected, account);
  write();
  expect(bind(provider)).toBeNull();
  expect(bind('apple-on-device')?.()).toBe(true);
  const replaceSelection = selected.begin();
  replaceSelection();
  expect(bind('apple-on-device')).toBeNull();
});

test('selection change during lookup cannot grant authority to the old result', () => {
  const selected = createCredentialMutationOwner();
  const account = createCredentialMutationOwner();
  const bind = captureConversationSelectionWitness(selected, account);
  selected.begin()();
  expect(bind(provider)).toBeNull();
  expect(bind('apple-on-device')).toBeNull();
});
