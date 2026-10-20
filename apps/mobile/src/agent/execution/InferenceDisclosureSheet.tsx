import { inferenceConsentCopy } from './inferenceConsentCopy';
import { useContext, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { AppText as Text } from '../../layout/AppText';
import { AppButton } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import {
  InferenceDisclosurePreview,
  previewMessage,
} from './InferenceDisclosurePreview';
import { disclosureStyles as styles } from './InferenceDisclosureStyles';

interface InferenceDisclosureSheetProps {
  readonly request: OutboundProcessingRequest | null;
  readonly onDecision: (approved: boolean) => void;
  readonly canRemember?: boolean;
}

/** Recognize only the actual calendar request shape; other payloads retain an honest generic label. */
function isCalendarRequest(request: OutboundProcessingRequest): boolean {
  return request.payload.messages.some(message => {
    if (message.role !== 'user' || typeof message.content !== 'string')
      return false;
    try {
      const value: unknown = JSON.parse(message.content);
      if (
        !value ||
        typeof value !== 'object' ||
        !('candidates' in value) ||
        !Array.isArray(value.candidates)
      )
        return false;
      return (
        value.candidates.length > 0 &&
        value.candidates.every((item: unknown) => {
          if (!item || typeof item !== 'object' || !('event' in item))
            return false;
          const event = item.event;
          return (
            event &&
            typeof event === 'object' &&
            'title' in event &&
            typeof event.title === 'string' &&
            'startsAt' in event &&
            typeof event.startsAt === 'string'
          );
        })
      );
    } catch {
      return false;
    }
  });
}

/** The compact summary opens an exact payload review; incomplete attachment previews remain blocked. */
export default function InferenceDisclosureSheet({
  request,
  onDecision,
  canRemember = true,
}: InferenceDisclosureSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const insets = useContext(SafeAreaInsetsContext);
  useEffect(() => setExpanded(false), [request]);
  if (!request) return null;
  const complete = request.payload.messages.every(
    message => previewMessage(message).complete,
  );
  const chatGPT = request.providerId.startsWith('chatgpt-plan:');
  const model =
    request.modelId === 'gpt-6-luna' ? 'GPT-6-Luna' : request.modelId;
  const calendar =
    request.consentScope?.purpose === 'calendar_classification' ||
    isCalendarRequest(request);
  const copy = inferenceConsentCopy(request);
  return (
    <Modal
      testID="inference-disclosure-modal"
      animationType="slide"
      // UIKit owns the pull-down gesture; dismissal is the same denied decision
      // as Cancel, never implicit approval or a reusable permission receipt.
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={() => onDecision(false)}
      visible
    >
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          style={styles.panel}
          testID="inference-disclosure-sheet"
        >
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <View style={styles.icon}>
                <AppSymbol name="paperplane" size={24} color={appColors.text} />
              </View>
              <Text accessibilityRole="header" style={styles.title}>
                {t('medicalAppointments.inferenceDisclosure.title')}
              </Text>
              <Text style={styles.subtitle}>{copy.subtitle}</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>
                  {t('medicalAppointments.inferenceDisclosure.recipient')}
                </Text>
                <Text style={styles.value}>
                  {chatGPT
                    ? t('medicalAppointments.inferenceDisclosure.account')
                    : request.recipient}
                </Text>
                {!chatGPT && !copy.publicSearch ? (
                  <Text style={styles.label}>{request.providerId}</Text>
                ) : null}
              </View>
              {!copy.publicSearch ? (
                <>
                  <View style={styles.separator} />
                  <View style={styles.row}>
                    <Text style={styles.label}>
                      {t(
                        'medicalAppointments.inferenceDisclosure.selectedModel',
                      )}
                    </Text>
                    <Text style={styles.value}>{model}</Text>
                  </View>
                </>
              ) : null}
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>
                {t('medicalAppointments.inferenceDisclosure.information')}
              </Text>
              <Text style={styles.value}>{copy.information}</Text>
              <Text style={styles.noticeBody}>
                {calendar
                  ? t('medicalAppointments.inferenceDisclosure.calendarPurpose')
                  : t('medicalAppointments.inferenceDisclosure.reviewHint')}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(value => !value)}
              style={styles.expand}
              testID="inference-disclosure-expand"
            >
              <Text style={styles.expandText}>
                {t('medicalAppointments.inferenceDisclosure.expand')}
              </Text>
              <AppSymbol
                name={expanded ? 'chevron.down' : 'chevron.right'}
                size={16}
              />
            </Pressable>
            {expanded ? <InferenceDisclosurePreview request={request} /> : null}
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>
                {canRemember
                  ? t('medicalAppointments.inferenceDisclosure.remember')
                  : t('medicalAppointments.inferenceDisclosure.oneTime')}
              </Text>
              <Text style={styles.noticeBody}>
                {canRemember
                  ? t('medicalAppointments.inferenceDisclosure.changes')
                  : t('medicalAppointments.inferenceDisclosure.unavailable')}
              </Text>
            </View>
            {!complete ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {t('medicalAppointments.inferenceDisclosure.blockedAttachment')}
              </Text>
            ) : null}
          </ScrollView>
          <View
            style={[
              styles.footer,
              { paddingBottom: Math.max(insets?.bottom ?? 0, 16) },
            ]}
          >
            <Text style={styles.footerNote}>
              {t('medicalAppointments.inferenceDisclosure.settingsHint')}
            </Text>
            <AppButton
              disabled={!complete}
              title={t('medicalAppointments.inferenceDisclosure.allow')}
              onPress={() => onDecision(true)}
              testID="inference-disclosure-allow"
            />
            <AppButton
              variant="neutral"
              title={t('medicalAppointments.inferenceDisclosure.cancel')}
              onPress={() => onDecision(false)}
              testID="inference-disclosure-cancel"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
