import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ConversationA2UISurface } from './ConversationA2UISurface';
import { AppText as Text } from '../layout/AppText';
import { styles } from './ConversationScreen.styles';

/** Brief replies replace the pending turn before a local receipt appears. This timer only
 * controls presentation; it cannot dispatch work, infer progress, or persist an answer. */
export function ConversationInitialResponse({
  response,
  allowLiveLayout = false,
}: {
  readonly response: {
    readonly text: string;
    readonly source?: 'receipt';
    readonly presentation?: 'card';
  };
  readonly allowLiveLayout?: boolean;
}) {
  const [showReceipt, setShowReceipt] = useState(false);
  useEffect(() => {
    if (response.source !== 'receipt') return;
    const timer = setTimeout(() => setShowReceipt(true), 750);
    return () => clearTimeout(timer);
  }, [response.source]);
  if (response.source === 'receipt' && !showReceipt) return null;
  if (allowLiveLayout && !response.source && response.presentation === 'card')
    return (
      <View
        accessibilityLiveRegion="polite"
        testID="rag-conversation-initial-response"
      >
        <ConversationA2UISurface
          testID="conversation-reviewed-opening-a2ui"
          root={{
            id: 'opening',
            component: 'Card',
            children: [
              {
                id: 'text',
                component: 'Text',
                variant: 'body',
                text: response.text,
              },
            ],
          }}
        />
      </View>
    );
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
