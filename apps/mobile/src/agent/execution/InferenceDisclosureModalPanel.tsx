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
  readonly request: OutboundProcessingRequest;
  readonly onDecision: (approved: boolean) => void;
  readonly canRemember: boolean;
  readonly calendar: boolean;
}

/** Measures and lays out disclosure content within the native Modal window. */
export default function InferenceDisclosureModalPanel({
  request,
  onDecision,
  canRemember,
  calendar,
}: InferenceDisclosureModalPanelProps) {
  const [expanded, setExpanded] = useState(false);
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
        request?.consentScope?.purpose === 'public_web_search' && !canRemember,
      ),
    [request, canRemember],
  );
  const complete = request.payload.messages.every(
    message => previewMessage(message).complete,
  );
  const chatGPT = request.providerId.startsWith('chatgpt-plan:');
  const model =
    request.modelId === 'gpt-6-luna' ? 'GPT-6-Luna' : request.modelId;
  const copy = inferenceConsentCopy(request);

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
      {/* Keep both consent facts in one sticky child so neither displaces the other. */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          compact && styles.compactContent,
        ]}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[1]}
        testID="inference-disclosure-content"
      >
        <View style={[styles.header, compact && styles.compactHeader]}>
          <View style={styles.icon}>
            <AppSymbol name="paperplane" size={24} color={appColors.text} />
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
            <Text style={styles.noticeBody}>
              {calendar
                ? t('medicalAppointments.inferenceDisclosure.calendarPurpose')
                : t('medicalAppointments.inferenceDisclosure.reviewHint')}
            </Text>
          </View>
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
          <Text style={styles.footerNote}>
            {t('medicalAppointments.inferenceDisclosure.settingsHint')}
          </Text>
        </View>
        {!complete ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {t('medicalAppointments.inferenceDisclosure.blockedAttachment')}
          </Text>
        ) : null}
      </ScrollView>
      {/* Keep consent decisions reachable while the disclosure content scrolls. */}
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
        )}
      </SafeAreaInsetsContext.Consumer>
    </View>
  );
}
