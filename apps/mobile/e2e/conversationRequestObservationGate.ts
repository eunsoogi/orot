/** Only the synthetic Routes scenario with an explicit test nonce can arm request diagnostics. */
export function conversationRequestObservationEnabled(
  settings: Record<string, unknown>,
): boolean {
  const nonce = settings.OROT_TEST_CONVERSATION_HIT_OBSERVATION;
  return (
    settings.OROT_TEST_SCENARIO === 'ai-feature-visit-questions' &&
    settings.OROT_TEST_NAVIGATION_OBSERVATION === 'YES' &&
    typeof nonce === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      nonce,
    )
  );
}
