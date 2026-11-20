import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ConversationBackButton } from './ConversationBackButton';
import { styles } from './ConversationScreen.styles';

/** Keep navigation and model selection separate from the current transcript. */
export function ConversationScreenHeader({
  routeKey,
  onBack,
  provider,
}: {
  readonly routeKey?: string;
  readonly onBack: () => void;
  readonly provider?: ReactNode;
}) {
  if (routeKey && !provider) return null;
  return (
    <View style={styles.header}>
      {!routeKey && <ConversationBackButton onBack={onBack} />}
      {provider ? <View style={styles.provider}>{provider}</View> : null}
    </View>
  );
}
