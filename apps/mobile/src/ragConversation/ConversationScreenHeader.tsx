import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { ConversationBackButton } from './ConversationBackButton';
import { ConversationArchiveAccess } from './ConversationArchiveAccess';
import { styles } from './ConversationScreen.styles';
import type { createConversationArchive } from './conversationArchive';

/** Route visibility also owns the modal archive; hidden screens cannot retain private overlays. */
export function ConversationScreenHeader({
  archive,
  active,
  routeKey,
  onBack,
  provider,
  notice,
}: {
  readonly archive: ReturnType<typeof createConversationArchive>;
  readonly active: boolean;
  readonly routeKey?: string;
  readonly onBack: () => void;
  readonly provider?: ReactNode;
  readonly notice: string;
}) {
  return (
    <View style={styles.header}>
      <ConversationArchiveAccess archive={archive} active={active} />
      {!routeKey && <ConversationBackButton onBack={onBack} />}
      {provider ? <View style={styles.provider}>{provider}</View> : null}
      <Text style={styles.disclaimer}>{notice}</Text>
    </View>
  );
}
