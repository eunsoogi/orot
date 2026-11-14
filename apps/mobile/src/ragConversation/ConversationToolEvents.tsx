import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { styles } from './ConversationScreen.styles';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import { ConversationToolEventSources } from './ConversationToolEventSources';
import { conversationToolLabel } from './conversationToolLabels';
import { sourceKindLabel } from './ConversationToolEventPresentation';

function statusLabel(status: ConversationToolEvent['status']) {
  switch (status) {
    case 'started':
      return t('ragConversation.tool.status.started');
    case 'completed':
      return t('ragConversation.tool.status.completed');
    case 'failed':
      return t('ragConversation.tool.status.failed');
    case 'cancelled':
      return t('ragConversation.tool.status.cancelled');
    case 'interrupted':
      return t('ragConversation.tool.status.interrupted');
  }
}

function ConversationToolEventDisclosure({
  event,
  sessionId,
  durableMessageId,
  resolveToolSource,
  onOpenSource,
  onLinkError,
  allowSourceActions,
}: {
  readonly event: ConversationToolEvent;
  readonly sessionId: string | null;
  readonly durableMessageId?: string;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly allowSourceActions: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const failed = event.status === 'failed';
  const detailsId = `rag-tool-event-${event.operationRunId}-${event.callId}-details`;
  const toggleId = `rag-tool-event-${event.operationRunId}-${event.callId}-toggle`;

  return (
    <View style={styles.toolEventCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${conversationToolLabel(event.toolName)} ${statusLabel(event.status)}`}
        accessibilityHint={
          expanded
            ? t('ragConversation.tool.collapseHint')
            : t('ragConversation.tool.expandHint')
        }
        accessibilityState={{ expanded, busy: event.status === 'started' }}
        onPress={() => setExpanded(value => !value)}
        style={styles.toolEventToggle}
        testID={toggleId}
      >
        <Text numberOfLines={2} style={styles.toolEventName}>
          {conversationToolLabel(event.toolName)}
        </Text>
        <Text
          accessibilityLiveRegion={
            event.status === 'started' ? 'polite' : undefined
          }
          accessibilityRole={failed ? 'alert' : undefined}
          style={[styles.toolEventStatus, failed && styles.error]}
        >
          {statusLabel(event.status)}
        </Text>
        <AppSymbol
          color={appColors.secondary}
          name={expanded ? 'chevron.up' : 'chevron.down'}
          size={16}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.toolEventDetails} testID={detailsId}>
          <View style={styles.toolEventSection}>
            <Text style={styles.toolEventSectionLabel}>
              {t('ragConversation.tool.input')}
            </Text>
            <Text style={styles.toolEventValue}>
              {sourceKindLabel(event.inputSummary.sourceKind)}
            </Text>
          </View>
          <View style={styles.toolEventSection}>
            <Text style={styles.toolEventSectionLabel}>
              {t('ragConversation.tool.result')}
            </Text>
            <Text style={[styles.toolEventValue, failed && styles.error]}>
              {event.resultSummary
                ? t('ragConversation.tool.resultCount', {
                    count: event.resultSummary.referenceCount,
                  })
                : t('ragConversation.tool.resultUnavailable')}
            </Text>
          </View>
          <ConversationToolEventSources
            allowSourceActions={allowSourceActions}
            durableMessageId={durableMessageId}
            event={event}
            onLinkError={onLinkError}
            onOpenSource={onOpenSource}
            resolveToolSource={resolveToolSource}
            sessionId={sessionId}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Keep a call's disclosure state tied to its transcript and durable event identity. */
export function ConversationToolEvents({
  events,
  messageId,
  durableMessageId,
  sessionId = '',
  resolveToolSource,
  onOpenSource,
  onLinkError,
  allowSourceActions = false,
}: {
  readonly events: readonly ConversationToolEvent[];
  readonly messageId: string;
  readonly durableMessageId?: string;
  readonly sessionId?: string | null;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly allowSourceActions?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const grouped = events.length > 1;
  // Keep every distinct state visible in the summary; never call mixed outcomes successful.
  const summary = [
    ...new Set(events.map(event => statusLabel(event.status))),
  ].join(', ');
  return (
    <View style={styles.toolEvents} testID="rag-conversation-tool-events">
      {grouped ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            t('ragConversation.tool.group', { count: events.length }) +
            ', ' +
            summary
          }
          onPress={() => setExpanded(value => !value)}
          style={styles.toolEventToggle}
          testID="rag-tool-group-toggle"
        >
          <Text style={styles.toolEventName}>
            {t('ragConversation.tool.group', { count: events.length })}
          </Text>
          <Text style={styles.toolEventStatus}>{summary}</Text>
          <AppSymbol
            color={appColors.secondary}
            name={expanded ? 'chevron.up' : 'chevron.down'}
            size={16}
          />
        </Pressable>
      ) : null}
      {/* Keep disclosure state mounted through group toggles and streaming updates. */}
      <View style={grouped && !expanded ? styles.toolEventsHidden : undefined}>
        {events.map(event => {
          // Retries may reuse a call ID, so their run identities keep disclosures separate.
          return (
            <ConversationToolEventDisclosure
              event={event}
              key={`${sessionId}/${messageId}/${event.operationRunId}/${event.callId}`}
              sessionId={sessionId}
              durableMessageId={durableMessageId}
              resolveToolSource={resolveToolSource}
              onOpenSource={onOpenSource}
              onLinkError={onLinkError}
              allowSourceActions={allowSourceActions}
            />
          );
        })}
      </View>
    </View>
  );
}
