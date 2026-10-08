import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LanguageModelMessage } from '@orot/model-runtime';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { t } from '../../i18n';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
  },
  panel: {
    maxHeight: '92%',
    gap: 12,
    padding: 20,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  title: { fontSize: 22, fontWeight: '700' },
  sectionTitle: { fontWeight: '700', marginTop: 12 },
  message: { gap: 6, padding: 12, backgroundColor: '#f2f4f7' },
  code: { fontFamily: 'monospace' },
  actions: { gap: 8 },
  button: { padding: 14, borderRadius: 8, alignItems: 'center' },
  allow: { backgroundColor: '#173b2b' },
  deny: { backgroundColor: '#e8ebef' },
  allowText: { color: '#fff', fontWeight: '700' },
  denyText: { color: '#18212b', fontWeight: '700' },
  disabledText: { color: '#7b8490' },
});

interface MessagePreview {
  readonly text: string;
  readonly complete: boolean;
}

function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return t('medicalAppointments.inferenceDisclosure.previewUnavailable');
  }
}

function previewMessage(message: LanguageModelMessage): MessagePreview {
  if (message.role === 'tool') {
    return {
      text: jsonPreview({
        toolCallId: message.toolCallId,
        result: message.result,
      }),
      complete: true,
    };
  }

  let complete = true;
  const content =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .map(part => {
            if (part.type === 'text') return part.text;
            complete = false;
            return t(
              'medicalAppointments.inferenceDisclosure.attachmentUnavailable',
              { type: part.type },
            );
          })
          .join('\n');
  const toolCalls =
    message.role === 'assistant' ? message.toolCalls : undefined;

  return {
    text: toolCalls?.length
      ? `${content}\n${t('medicalAppointments.inferenceDisclosure.toolCalls')}\n${jsonPreview(toolCalls)}`
      : content,
    complete,
  };
}

function roleLabel(message: LanguageModelMessage): string {
  switch (message.role) {
    case 'system':
      return t('medicalAppointments.inferenceDisclosure.role.system');
    case 'user':
      return t('medicalAppointments.inferenceDisclosure.role.user');
    case 'assistant':
      return t('medicalAppointments.inferenceDisclosure.role.assistant');
    case 'tool':
      return t('medicalAppointments.inferenceDisclosure.role.tool');
  }
}

interface InferenceDisclosureSheetProps {
  readonly request: OutboundProcessingRequest | null;
  readonly onDecision: (approved: boolean) => void;
}

/** Shows only the provider request; run and evidence-scope identifiers stay local. */
export default function InferenceDisclosureSheet({
  request,
  onDecision,
}: InferenceDisclosureSheetProps) {
  if (!request) return null;

  const previews = request.payload.messages.map(previewMessage);
  const complete = previews.every(preview => preview.complete);
  const settings = {
    ...(request.payload.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: request.payload.maxOutputTokens }),
    ...(request.payload.temperature === undefined
      ? {}
      : { temperature: request.payload.temperature }),
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => onDecision(false)}
      transparent
      visible
    >
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          style={styles.panel}
          testID="inference-disclosure-sheet"
        >
          <Text accessibilityRole="header" style={styles.title}>
            {t('medicalAppointments.inferenceDisclosure.title')}
          </Text>
          <Text>
            {t('medicalAppointments.inferenceDisclosure.service')}:{' '}
            {request.providerId}
          </Text>
          <Text>
            {t('medicalAppointments.inferenceDisclosure.recipient')}:{' '}
            {request.recipient}
          </Text>
          <Text>
            {t('medicalAppointments.inferenceDisclosure.model')}:{' '}
            {request.modelId}
          </Text>
          <Text>
            {t('medicalAppointments.inferenceDisclosure.privacyBoundary')}
          </Text>
          <ScrollView testID="inference-disclosure-preview">
            <Text style={styles.sectionTitle}>
              {t('medicalAppointments.inferenceDisclosure.sentMessages')}
            </Text>
            {request.payload.messages.map((message, index) => (
              <View key={`${message.role}-${index}`} style={styles.message}>
                <Text style={styles.sectionTitle}>{roleLabel(message)}</Text>
                <Text testID={`inference-disclosure-message-${index}`}>
                  {previews[index]?.text ?? ''}
                </Text>
              </View>
            ))}
            {request.payload.tools?.length ? (
              <View>
                <Text style={styles.sectionTitle}>
                  {t('medicalAppointments.inferenceDisclosure.tools')}
                </Text>
                <Text style={styles.code}>
                  {jsonPreview(request.payload.tools)}
                </Text>
              </View>
            ) : null}
            {request.payload.responseFormat ? (
              <View>
                <Text style={styles.sectionTitle}>
                  {t('medicalAppointments.inferenceDisclosure.responseFormat')}
                </Text>
                <Text style={styles.code}>
                  {jsonPreview(request.payload.responseFormat)}
                </Text>
              </View>
            ) : null}
            {Object.keys(settings).length > 0 ? (
              <View>
                <Text style={styles.sectionTitle}>
                  {t('medicalAppointments.inferenceDisclosure.settings')}
                </Text>
                <Text style={styles.code}>{jsonPreview(settings)}</Text>
              </View>
            ) : null}
          </ScrollView>
          {!complete ? (
            <Text accessibilityRole="alert">
              {t('medicalAppointments.inferenceDisclosure.blockedAttachment')}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !complete }}
              disabled={!complete}
              onPress={() => onDecision(true)}
              style={[styles.button, styles.allow]}
              testID="inference-disclosure-allow"
            >
              <Text style={complete ? styles.allowText : styles.disabledText}>
                {t('medicalAppointments.inferenceDisclosure.allow')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onDecision(false)}
              style={[styles.button, styles.deny]}
              testID="inference-disclosure-cancel"
            >
              <Text style={styles.denyText}>
                {t('medicalAppointments.inferenceDisclosure.cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
