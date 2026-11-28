import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

interface MedicalDocumentImportActionProps {
  readonly opening: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly showDivider?: boolean;
  readonly compact?: boolean;
  readonly source?: 'files' | 'photos';
}

/** Keeps document import in the Records body instead of duplicating it in navigation actions. */
export function MedicalDocumentImportAction({
  opening,
  disabled,
  onPress,
  showDivider = false,
  compact = false,
  source = 'files',
}: MedicalDocumentImportActionProps) {
  // Keep the source-specific name stable when the picker status description changes.
  const label = t(
    source === 'photos'
      ? 'medicalDocument.import.photos'
      : 'medicalDocument.import.title',
  );
  const summary = t(
    opening
      ? source === 'photos'
        ? 'medicalDocument.import.photosOpening'
        : 'medicalDocument.import.opening'
      : source === 'photos'
        ? 'medicalDocument.import.photosSummary'
        : 'medicalDocument.import.summary',
  );
  const content = compact ? (
    <>
      <AppSymbol
        name={source === 'photos' ? 'photo' : 'doc.text'}
        color={appColors.primaryText}
      />
      <View style={styles.copy}>
        <Text style={styles.compactTitle}>
          {t(
            source === 'photos'
              ? 'records.importPhotos'
              : 'records.importFiles',
          )}
        </Text>
        {opening ? <Text style={styles.summary}>{summary}</Text> : null}
      </View>
    </>
  ) : (
    <>
      <View style={styles.icon}>
        <AppSymbol
          name={source === 'photos' ? 'photo' : 'doc.text'}
          color={appColors.primaryAction}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.summary}>{summary}</Text>
      </View>
      <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
    </>
  );
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityHint={compact ? summary : undefined}
      accessibilityState={{ busy: opening, disabled }}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        compact ? styles.compact : styles.row,
        showDivider && styles.divider,
        disabled && styles.disabled,
      ]}
      testID={
        source === 'photos'
          ? 'records-import-medical-photo'
          : 'records-import-medical-document'
      }
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  compactTitle: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    minWidth: 0,
    paddingVertical: 9,
  },
  divider: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  summary: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
  disabled: { opacity: 0.55 },
});
