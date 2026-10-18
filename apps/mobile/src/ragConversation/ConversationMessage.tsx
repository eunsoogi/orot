import { Linking, Pressable, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { RagConversationMessage } from './task';

export interface DisplayMessage extends RagConversationMessage {
  readonly id: number;
  readonly citations?: readonly EvidenceReference[];
  readonly activity?: string;
  readonly streaming?: boolean;
  readonly incomplete?: boolean;
}

/** Citation labels reveal source type and date; opaque record aliases remain implementation details. */
export function ConversationMessage({
  message,
  onOpenSource,
  onLinkError,
}: {
  readonly message: DisplayMessage;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
}) {
  const user = message.role === 'user';
  return (
    <View style={user ? styles.userMessage : styles.assistantMessage}>
      {!user && (
        <View style={styles.speaker}>
          <View style={styles.avatar}>
            <AppSymbol
              name="sparkles"
              color={appColors.primaryText}
              size={20}
            />
          </View>
          <Text style={styles.role}>오롯</Text>
        </View>
      )}
      <View style={!user && styles.assistantBody}>
        {message.incomplete && message.content ? (
          <>
            <Text style={styles.activity}>
              {t('aiActivity.draft.incompleteHeading')}
            </Text>
            <Text style={styles.activity}>
              {t('aiActivity.draft.incompleteNote')}
            </Text>
          </>
        ) : null}
        {message.content ? (
          <Text
            selectable
            style={[styles.messageText, user && styles.userText]}
            testID={message.streaming ? 'rag-conversation-stream' : undefined}
          >
            {message.content}
          </Text>
        ) : null}
        {message.activity ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.activity}
            testID={message.streaming ? 'rag-conversation-progress' : undefined}
          >
            {message.activity}
          </Text>
        ) : null}
        {message.citations?.map((reference, index) => {
          const external = reference.sourceKind === 'external_medical';
          const locator = reference.locator as Record<string, unknown> | null;
          const url =
            external && typeof locator?.originalUrl === 'string'
              ? locator.originalUrl
              : '';
          const title = external
            ? typeof locator?.title === 'string'
              ? locator.title
              : 'Europe PMC 문헌'
            : reference.sourceKind === 'reviewed_memory'
              ? '검토한 메모'
              : '건강 기록';
          const date = reference.effectiveTime?.slice(0, 10);
          return (
            <Pressable
              key={`${reference.sourceId}:${reference.evidenceId}:${index}`}
              accessibilityRole="button"
              accessibilityLabel={`원문 근거 열기 · ${title}${date ? ` · ${date}` : ''}`}
              style={styles.source}
              onPress={() => {
                if (!external) {
                  onOpenSource(reference);
                  return;
                }
                if (!isSafeEuropePmcArticleUrl(url)) {
                  onLinkError();
                  return;
                }
                Linking.openURL(url).catch(onLinkError);
              }}
            >
              <AppSymbol
                name={external ? 'book' : 'doc.text'}
                color={appColors.primaryText}
                size={22}
              />
              <Text style={styles.sourceText}>
                {title}
                {date ? ` · ${date}` : ''}
                {external ? '\nEurope PMC · 공개 의학 문헌' : ''}
                {external && typeof locator?.retrievedAt === 'string'
                  ? ` · 조회 ${locator.retrievedAt.slice(0, 10)}`
                  : ''}
              </Text>
              <AppSymbol name="chevron.right" size={14} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
