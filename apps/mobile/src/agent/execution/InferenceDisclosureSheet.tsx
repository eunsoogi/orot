import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { KeyboardAvoidingView, Modal, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import InferenceDisclosureModalPanel from './InferenceDisclosureModalPanel';
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

/** Incomplete attachment previews stay blocked while every approval remains explicit. */
export default function InferenceDisclosureSheet({
  request,
  onDecision,
  canRemember = true,
}: InferenceDisclosureSheetProps) {
  if (!request) return null;
  const calendar =
    request.consentScope?.purpose === 'calendar_classification' ||
    isCalendarRequest(request);

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
      <SafeAreaProvider
        style={styles.backdrop}
        testID="inference-disclosure-modal-safe-area"
      >
        {/* Modal has its own native window; do not size this sheet from the calling route. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.backdrop}
        >
          <InferenceDisclosureModalPanel
            request={request}
            onDecision={onDecision}
            canRemember={canRemember}
            calendar={calendar}
          />
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}
