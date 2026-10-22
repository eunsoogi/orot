import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import type { EvidenceSourceDetailSection } from './evidenceSourcePresentation';

/** Tabs select saved records, never inferred summaries or illustrative health values. */
export function EvidenceSourceSections({
  sections,
}: {
  readonly sections: readonly EvidenceSourceDetailSection[];
}) {
  const [selected, setSelected] = useState(0);
  const { fontScale, width } = useWindowDimensions();
  const section = sections[selected] ?? sections[0];
  if (!section) return null;
  const hero = section.hero;
  const rows = section.rows.filter(
    row => !hero?.consumedLabels.includes(row.label),
  );
  const stacked = fontScale > 1.3 || width < 350;
  return (
    <>
      {sections.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {sections.map((item, index) => (
            <Pressable
              key={`${item.title}-${index}`}
              accessibilityRole="tab"
              accessibilityLabel={`${item.title} ${index + 1}`}
              accessibilityState={{ selected: selected === index }}
              onPress={() => setSelected(index)}
              style={[styles.tab, selected === index && styles.selected]}
            >
              <AppSymbol
                name="doc.text"
                size={18}
                color={
                  selected === index ? appColors.onPrimary : appColors.text
                }
              />
              <Text
                style={selected === index ? styles.selectedText : undefined}
              >
                {item.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.section}>
        <View style={styles.category}>
          <AppSymbol name="doc.text" size={20} color={appColors.secondary} />
          <Text style={styles.categoryText}>{section.title}</Text>
        </View>
        {hero?.heading ? (
          <Text accessibilityRole="header" style={styles.title}>
            {hero.heading}
          </Text>
        ) : null}
        {hero?.value ? (
          <Text selectable style={styles.primaryValue}>
            {hero.value}
          </Text>
        ) : null}
        {hero?.body ? (
          <Text selectable style={styles.body}>
            {hero.body}
          </Text>
        ) : null}
        {hero?.at ? (
          <Text style={styles.date}>
            {hero.atLabel} · {hero.at}
          </Text>
        ) : null}
        {rows.map((row, index) => (
          <View
            key={`${row.label}-${index}`}
            style={[styles.row, stacked && styles.stacked]}
          >
            <Text style={styles.label}>{row.label}</Text>
            <Text
              selectable
              style={[styles.value, stacked && styles.stackedValue]}
            >
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: 8, paddingVertical: 4 },
  tab: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selected: { backgroundColor: appColors.primaryAction },
  selectedText: { color: appColors.onPrimary },
  section: {
    backgroundColor: appColors.surface,
    borderRadius: 22,
    gap: 12,
    padding: 20,
  },
  category: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryText: { color: appColors.secondary, fontSize: 14 },
  title: { fontSize: 21, fontWeight: '600' },
  primaryValue: {
    fontSize: 34,
    fontWeight: '600',
    color: appColors.primaryText,
  },
  body: { fontSize: 16, lineHeight: 24 },
  date: {
    fontSize: 14,
    lineHeight: 21,
    color: appColors.secondary,
    marginBottom: 8,
  },
  row: {
    gap: 12,
    minHeight: 32,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  stacked: { flexDirection: 'column', gap: 4 },
  label: { color: appColors.secondary, fontSize: 14 },
  value: {
    flexShrink: 1,
    maxWidth: '68%',
    textAlign: 'right',
    color: appColors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  stackedValue: { maxWidth: '100%', textAlign: 'left' },
});
