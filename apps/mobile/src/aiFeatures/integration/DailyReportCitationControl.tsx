import type { ReactNode } from 'react';
import { AppButton } from '../../layout/AppButton';
import {
  ConversationCitationStrip,
  ConversationSourcePill,
} from '../../ragConversation/ConversationSourcePill';

interface Props {
  readonly transcript: boolean;
  readonly testID?: string;
  readonly title: string;
  readonly initial?: boolean;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onPress: () => void;
}

/** A transcript source uses the normal pill; standalone reports keep their existing controls. */
export function DailyReportCitationControl({
  transcript,
  testID,
  title,
  initial,
  expanded,
  disabled,
  busy,
  onPress,
}: Props) {
  return transcript ? (
    <ConversationSourcePill
      testID={testID}
      caption={title}
      label={title}
      icon="doc.text"
      expanded={expanded}
      disabled={disabled}
      busy={busy}
      onPress={onPress}
    />
  ) : (
    <AppButton
      testID={testID}
      title={title}
      variant={initial ? 'secondary' : 'text'}
      accessibilityState={{ expanded }}
      disabled={disabled}
      busy={busy}
      onPress={onPress}
    />
  );
}

export function DailyReportCitationStrip({
  transcript,
  testID,
  children,
}: {
  readonly transcript: boolean;
  readonly testID?: string;
  readonly children: ReactNode;
}) {
  return transcript ? (
    <ConversationCitationStrip testID={testID}>
      {children}
    </ConversationCitationStrip>
  ) : (
    <>{children}</>
  );
}
