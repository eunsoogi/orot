import DateTimePicker from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { AppText } from '../layout/AppText';
import { canonicalConversationDraftDate } from './canonicalConversationDraftDate';

/** A neutral bubble-local date draft; it has no access to calendars or model requests. */
export function ConversationA2UITemporaryDate({
  label,
  min,
  max,
  current,
}: {
  readonly label: string;
  readonly min: string;
  readonly max: string;
  readonly current: () => boolean;
}) {
  const [value, setValue] = useState<string>();
  const [picker, setPicker] = useState<number>();
  const [preview, setPreview] = useState<string>();
  const generation = useRef(0);
  const currentPicker = () =>
    current() && picker !== undefined && generation.current === picker;
  const close = () => {
    generation.current += 1;
    setPicker(undefined);
    setPreview(undefined);
  };
  const shown = value ?? t('ragConversation.a2ui.chooseDate');
  const date = (day: string) => new Date(day + 'T00:00:00.000Z');
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label + ', ' + shown}
        accessibilityState={{ expanded: picker !== undefined }}
        style={styles.opener}
        onPress={() => {
          if (!current()) return;
          if (picker !== undefined) close();
          else {
            setPreview(value ?? min);
            setPicker(++generation.current);
          }
        }}
      >
        <AppText allowFontScaling>{shown}</AppText>
      </Pressable>
      {picker !== undefined && preview ? (
        <>
          <DateTimePicker
            testID="conversation-a2ui-local-date-picker"
            accessibilityLabel={label}
            display="inline"
            mode="date"
            timeZoneName="UTC"
            minimumDate={date(min)}
            maximumDate={date(max)}
            value={date(preview)}
            onValueChange={(_, selected) => {
              if (
                !currentPicker() ||
                !(selected instanceof Date) ||
                !Number.isFinite(selected.getTime())
              )
                return;
              const day = canonicalConversationDraftDate(
                selected.toISOString().slice(0, 10),
              );
              if (day === undefined || day < min || day > max) return;
              setPreview(day);
            }}
            onDismiss={() => {
              if (currentPicker()) close();
            }}
          />
          <Pressable
            accessibilityRole="button"
            style={styles.opener}
            onPress={() => {
              if (!currentPicker()) return;
              setValue(preview);
              close();
            }}
          >
            <AppText allowFontScaling>
              {t('ragConversation.a2ui.confirmDate')}
            </AppText>
          </Pressable>
        </>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  opener: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: appColors.primarySoft,
  },
});
