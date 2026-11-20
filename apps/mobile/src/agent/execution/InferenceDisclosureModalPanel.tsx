import type { SettingsDisclosureSummary } from './settingsDisclosureSummary';
import { inferenceConsentCopy } from './inferenceConsentCopy';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
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
import {
  disclosureStyles as styles,
  isCompactDisclosureWindow,
} from './InferenceDisclosureStyles';

interface InferenceDisclosureModalPanelProps {
  readonly request?: OutboundProcessingRequest;
  readonly onDecision: (approved: boolean) => void;
  readonly canRemember: boolean;
  readonly calendar: boolean;
  readonly summary?: SettingsDisclosureSummary;
}

/** Measures and lays out disclosure content within the native Modal window. */
export default function InferenceDisclosureModalPanel({
  request,
  onDecision,
  canRemember,
  calendar,
  summary,
}: InferenceDisclosureModalPanelProps) {
  const realtimeResult =
    request?.providerId === 'openai-realtime' && !request.consentScope;
  const [expanded, setExpanded] = useState(realtimeResult);
  // Exact Realtime results are one-shot disclosures, never remembered permissions.
  const remember = canRemember && !realtimeResult;
  const [modalBounds, setModalBounds] = useState({ width: 0, height: 0 });
  const compact = isCompactDisclosureWindow(
    modalBounds.width,
    modalBounds.height,
  );
  // Unclassified web queries need an immediate exact review; they never inherit
  // the app-controlled topic permission or create a reusable approval receipt.
  useEffect(
    () =>
      setExpanded(
        realtimeResult ||
          (request?.consentScope?.purpose === 'public_web_search' &&
            !canRemember),
      ),
    [request, canRemember, realtimeResult],
  );
  const complete =
    summary !== undefined ||
    !!request?.payload.messages.every(
      message => previewMessage(message).complete,
    );
  const { providerId, modelId, recipient } = summary ?? request!;
  const chatGPT = providerId.startsWith('chatgpt-plan:');
  const model = modelId === 'gpt-6-luna' ? 'GPT-6-Luna' : modelId;
  const copy = summary
    ? { ...summary, publicSearch: false }
    : inferenceConsentCopy(request!);

  return (
    <View
      accessibilityViewIsModal
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setModalBounds(current =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
      }}
      style={styles.panel}
      testID="inference-disclosure-sheet"
    >
      {/* Keep the pull-down cue fixed while reviewing long input. UIKit owns the gesture. */}
      <View
        testID="inference-disclosure-grabber"
        style={[styles.grabber, compact && styles.compactGrabber]}
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {/* Consent details and decisions share one scroll owner at large text sizes. */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          compact && styles.compactContent,
        ]}
        keyboardShouldPersistTaps="handled"
        testID="inference-disclosure-content"
      >
        <View style={[styles.header, compact && styles.compactHeader]}>
          <View style={styles.icon}>
            <AppSymbol name="paperplane" color={appColors.text} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            {t('medicalAppointments.inferenceDisclosure.title')}
          </Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>
        </View>
        <View
          style={[styles.summary, compact && styles.compactSummary]}
          testID="inference-disclosure-summary"
        >
          <View
            style={[styles.card, compact && styles.compactCard]}
            testID="inference-disclosure-recipient-card"
          >
            <View style={styles.row}>
              <Text style={styles.label}>
                {t('medicalAppointments.inferenceDisclosure.recipient')}
              </Text>
              <Text
                style={styles.value}
                testID="inference-disclosure-recipient"
              >
                {chatGPT && !summary
                  ? t('medicalAppointments.inferenceDisclosure.account')
                  : recipient}
              </Text>
              {!summary && !chatGPT && !copy.publicSearch ? (
                <Text style={styles.label}>{providerId}</Text>
              ) : null}
            </View>
            {!copy.publicSearch ? (
              <>
                <View style={styles.separator} />
                <View style={styles.row}>
                  <Text style={styles.label}>
                    {t('medicalAppointments.inferenceDisclosure.selectedModel')}
                  </Text>
                  <Text style={styles.value}>{model}</Text>
                </View>
              </>
            ) : null}
          </View>
          <View
            style={[styles.card, compact && styles.compactCard]}
            testID="inference-disclosure-scope-card"
          >
            <Text style={styles.label}>
              {t('medicalAppointments.inferenceDisclosure.information')}
            </Text>
            <Text style={styles.value} testID="inference-disclosure-scope">
              {copy.information}
            </Text>
            {!summary ? (
              <Text style={styles.noticeBody}>
                {calendar && !realtimeResult
                  ? t('medicalAppointments.inferenceDisclosure.calendarPurpose')
                  : t('medicalAppointments.inferenceDisclosure.reviewHint')}
              </Text>
            ) : null}
          </View>
        </View>
        {!summary ? (
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
              color={appColors.secondary}
            />
          </Pressable>
        ) : null}
        {request && expanded ? (
          <InferenceDisclosurePreview request={request} />
        ) : null}
        <View style={styles.notice}>
          {!summary ? (
            <Text style={styles.noticeTitle}>
              {remember
                ? t('medicalAppointments.inferenceDisclosure.remember')
                : t('medicalAppointments.inferenceDisclosure.oneTime')}
            </Text>
          ) : null}
          <Text style={styles.noticeBody}>
            {summary
              ? summary.notice
              : remember
                ? t('medicalAppointments.inferenceDisclosure.changes')
                : t('medicalAppointments.inferenceDisclosure.unavailable')}
          </Text>
          {!summary && !realtimeResult ? (
            <Text style={styles.footerNote}>
              {t('medicalAppointments.inferenceDisclosure.settingsHint')}
            </Text>
          ) : null}
        </View>
        {!complete ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {t('medicalAppointments.inferenceDisclosure.blockedAttachment')}
          </Text>
        ) : null}
        <SafeAreaInsetsContext.Consumer>
          {modalInsets => (
            <View
              style={[
                styles.footer,
                compact && styles.compactFooter,
                { paddingBottom: Math.max(modalInsets?.bottom ?? 0, 16) },
              ]}
              testID="inference-disclosure-footer"
            >
              <AppButton
                disabled={!complete}
                title={t(
                  summary
                    ? 'medicalAppointments.inferenceDisclosure.settingsAgree'
                    : 'medicalAppointments.inferenceDisclosure.allow',
                )}
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
          )}
        </SafeAreaInsetsContext.Consumer>
      </ScrollView>
    </View>
  );
}
