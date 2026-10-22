import { View } from 'react-native';
import type { LanguageModelMessage } from '@orot/model-runtime';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { AppText as Text } from '../../layout/AppText';
import { t } from '../../i18n';
import { disclosureStyles as styles } from './InferenceDisclosureStyles';

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

export function previewMessage(message: LanguageModelMessage): MessagePreview {
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

/** Expanded review includes the actual request, including tool results and provider settings. */
export function InferenceDisclosurePreview({
  request,
}: {
  readonly request: OutboundProcessingRequest;
}) {
  const previews = request.payload.messages.map(previewMessage);
  const settings = {
    ...(request.payload.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: request.payload.maxOutputTokens }),
    ...(request.payload.temperature === undefined
      ? {}
      : { temperature: request.payload.temperature }),
  };
  return (
    <View testID="inference-disclosure-preview">
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
          <Text style={styles.code}>{jsonPreview(request.payload.tools)}</Text>
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
    </View>
  );
}
