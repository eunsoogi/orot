import { useCallback, useState } from 'react';
import { ClassificationReaderSceneControl } from './ClassificationReaderSceneControl';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ClassificationPagedStage } from '../src/medicalAppointments/ClassificationPagedStage';
import { useClassificationLayoutReceipt } from './classificationLayoutReceipt';

// Indexed synthetic text makes both truncation and duplicated pages observable.
export const readerGeometryDocuments = [1, 2].map(document =>
  ['title', 'reason']
    .map(field =>
      Array.from(
        { length: 24 },
        (_, index) => `DOC${document}_${field}_${index + 1}`,
      ).join(' '),
    )
    .join('\n\n'),
);

/** Direct product reader host: no workflow, account, consent, database or provider. */
export function ClassificationReaderGeometryProbe() {
  const [constrained, setConstrained] = useState(false);
  const [actions, setActions] = useState(0);
  const action = useCallback(() => setActions(value => value + 1), []);
  const layout = useClassificationLayoutReceipt(true);
  return (
    <View style={styles.root} testID="classification-geometry-host">
      {layout.marker}
      <View style={styles.controls}>
        <ClassificationReaderSceneControl />
        <Pressable
          testID="classification-geometry-sample"
          accessibilityRole="button"
          accessibilityLabel="Sample native geometry"
          onPress={layout.request}
          style={styles.button}
        >
          <Text allowFontScaling={false}>Sample</Text>
        </Pressable>
        <Pressable
          testID="classification-geometry-constrain"
          accessibilityRole="button"
          accessibilityLabel="Constrain synthetic lane"
          onPress={() => setConstrained(true)}
          style={styles.button}
        >
          <Text allowFontScaling={false}>Constrain</Text>
        </Pressable>
        <Text
          testID="classification-geometry-actions"
          allowFontScaling={false}
        >{`actions=${actions};lane=${constrained ? 'constrained' : 'natural'}`}</Text>
      </View>
      {/* Only this explicit second phase reduces the lane. It does not model a natural window. */}
      <View
        testID="classification-geometry-lane"
        style={constrained ? styles.constrained : styles.root}
      >
        <ClassificationPagedStage
          documents={readerGeometryDocuments}
          actionTitle="Local action"
          actionLabel="Local action"
          onAction={action}
          testID="classification-geometry-stage"
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  controls: { height: 45, flexDirection: 'row', alignItems: 'center' },
  button: { minHeight: 45, minWidth: 64, justifyContent: 'center' },
  constrained: { height: 64 },
});
