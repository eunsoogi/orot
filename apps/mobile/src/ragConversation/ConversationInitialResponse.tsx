import { useEffect, useState } from 'react';
import { AppText as Text } from '../layout/AppText';
import { styles } from './ConversationScreen.styles';

/** Brief replies replace the pending turn before a local receipt appears. This timer only
 * controls presentation; it cannot dispatch work, infer progress, or persist an answer. */
export function ConversationInitialResponse({
  response,
}: {
  readonly response: { readonly text: string; readonly source?: 'receipt' };
}) {
  const [showReceipt, setShowReceipt] = useState(false);
  useEffect(() => {
    if (response.source !== 'receipt') return;
    const timer = setTimeout(() => setShowReceipt(true), 750);
    return () => clearTimeout(timer);
  }, [response.source]);
  if (response.source === 'receipt' && !showReceipt) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={styles.messageText}
      testID="rag-conversation-initial-response"
    >
      {response.text}
    </Text>
  );
}
