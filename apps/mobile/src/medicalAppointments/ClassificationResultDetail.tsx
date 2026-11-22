import { ScrollView, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ClassificationEdgeAction } from './ClassificationEdgeAction';

export type ClassificationResultField = {
  readonly label: string;
  readonly value: string;
};

/** Each field wraps in one surface. Only overflow scrolls, never another page. */
export function ClassificationResultDetail({
  fields,
  top,
  back,
}: {
  readonly fields: readonly ClassificationResultField[];
  readonly top: number;
  readonly back: () => void;
}) {
  return (
    <View style={[styles.panel, { top }]} testID="classification-result-reader">
      <ClassificationEdgeAction
        direction="left"
        testID="classification-detail-back"
        label={t('medicalAppointments.backToResults')}
        onPress={back}
      />
      <ScrollView
        style={styles.viewport}
        contentContainerStyle={styles.fields}
        alwaysBounceVertical={false}
        testID="classification-detail-fields"
      >
        {fields.map(({ label, value }, index) => (
          <View key={label} style={styles.field}>
            <AppText
              style={styles.label}
              testID={`classification-detail-label-${index}`}
            >
              {label}
            </AppText>
            <AppText
              style={styles.value}
              testID={`classification-detail-value-${index}`}
            >
              {value}
            </AppText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  viewport: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  fields: { gap: 8, paddingHorizontal: 8, paddingBottom: 8 },
  field: { gap: 2 },
  label: { fontSize: 13, lineHeight: 17, color: appColors.secondary },
  value: { fontSize: 17, lineHeight: 22 },
});
