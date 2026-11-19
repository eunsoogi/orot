import { conversationRequestObservationEnabled } from './conversationRequestObservationGate';

test('arms only the opted-in synthetic Routes session', () => {
  const settings = {
    OROT_TEST_SCENARIO: 'ai-feature-visit-questions',
    OROT_TEST_NAVIGATION_OBSERVATION: 'YES',
    OROT_TEST_CONVERSATION_HIT_OBSERVATION:
      '6b2478a7-93f6-457e-8877-a875a0500511',
  };
  expect(conversationRequestObservationEnabled(settings)).toBe(true);
  expect(
    conversationRequestObservationEnabled({
      ...settings,
      OROT_TEST_SCENARIO: 'other',
    }),
  ).toBe(false);
  expect(
    conversationRequestObservationEnabled({
      ...settings,
      OROT_TEST_NAVIGATION_OBSERVATION: 'NO',
    }),
  ).toBe(false);
  expect(
    conversationRequestObservationEnabled({
      ...settings,
      OROT_TEST_CONVERSATION_HIT_OBSERVATION: 'invalid',
    }),
  ).toBe(false);
});
