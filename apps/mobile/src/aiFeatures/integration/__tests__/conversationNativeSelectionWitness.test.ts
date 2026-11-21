import { captureNativeConversationSelectionWitness } from '../conversationNativeSelectionWitness';
import { chatGPTCredentialMutation } from '../../../providers/chatGPTConsentIdentity';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';

const local = 'apple-foundation-models';
const plan = 'chatgpt-plan:account:example';

test('only default local and default ChatGPT credential routes carry authority', () => {
  const capture = captureNativeConversationSelectionWitness()!;
  expect(capture(local)?.()).toBe(true);
  expect(capture(plan)?.()).toBe(true);
  expect(capture('apple-private-cloud-compute')).toBeNull();
  expect(capture('unknown')).toBeNull();
  expect(
    captureNativeConversationSelectionWitness({
      selectionStore: providerSelectionStore,
    }),
  ).toBeUndefined();
});

test('an account relink vetoes existing ChatGPT readers without affecting local ones', () => {
  const capture = captureNativeConversationSelectionWitness()!;
  const account = capture(plan)!;
  const apple = capture(local)!;
  const finish = chatGPTCredentialMutation.begin();
  try {
    expect(account()).toBe(false);
    expect(apple()).toBe(true);
    expect(captureNativeConversationSelectionWitness()!(plan)).toBeNull();
  } finally {
    finish();
  }
  expect(account()).toBe(false);
  expect(captureNativeConversationSelectionWitness()!(plan)?.()).toBe(true);
});
