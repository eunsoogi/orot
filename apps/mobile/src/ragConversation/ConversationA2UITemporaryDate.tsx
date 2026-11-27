import DateTimePicker from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { AppText } from '../layout/AppText';
import { canonicalConversationDraftDate } from './canonicalConversationDraftDate';

/** Bubble-local drafts have no access to calendars or model requests. */
export function ConversationA2UITemporaryDate(
  props: { readonly label: string; readonly current: () => boolean } & (
    | { readonly mode?: 'date'; readonly min: string; readonly max: string }
    | { readonly mode: 'time' }
  ),
) {
  const { label, current } = props;
  const time = props.mode === 'time';
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
  const shown =
    value ??
    t(
      time
        ? 'ragConversation.a2ui.chooseTime'
        : 'ragConversation.a2ui.chooseDate',
    );
  // UTC is only an internal anchor for the picker. The accepted time is
  // a floating HH:mm value, never a date, offset, or scheduled instant.
  const date = (slot: string) =>
    new Date(
      time ? '2000-01-01T' + slot + ':00.000Z' : slot + 'T00:00:00.000Z',
    );
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
            setPreview(value ?? (time ? '00:00' : props.min));
            setPicker(++generation.current);
          }
        }}
      >
        <AppText allowFontScaling>{shown}</AppText>
      </Pressable>
      {picker !== undefined && preview ? (
        <>
          <DateTimePicker
            testID={
              time
                ? 'conversation-a2ui-local-time-picker'
                : 'conversation-a2ui-local-date-picker'
            }
            accessibilityLabel={label}
            display={time ? 'spinner' : 'inline'}
            mode={time ? 'time' : 'date'}
            timeZoneName="UTC"
            {...(time
              ? {}
              : { minimumDate: date(props.min), maximumDate: date(props.max) })}
            value={date(preview)}
            onValueChange={(_, selected) => {
              if (
                !currentPicker() ||
                !(selected instanceof Date) ||
                !Number.isFinite(selected.getTime())
              )
                return;
              if (time) {
                const two = (part: number) => String(part).padStart(2, '0');
                setPreview(
                  two(selected.getUTCHours()) +
                    ':' +
                    two(selected.getUTCMinutes()),
                );
                return;
              }
              const day = canonicalConversationDraftDate(
                selected.toISOString().slice(0, 10),
              );
              if (day === undefined || day < props.min || day > props.max)
                return;
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
              {t(
                time
                  ? 'ragConversation.a2ui.confirmTime'
                  : 'ragConversation.a2ui.confirmDate',
              )}
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
