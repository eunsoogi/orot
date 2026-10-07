import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export interface FeatureEntryScreenProps {
  readonly onOpenVisitQuestions: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
}

const features = [
  {
    id: 'visit-questions',
    title: '다음 진료 질문',
    description:
      '건강 기록과 녹음, 다음 예약, 기억을 바탕으로 진료 때 물어볼 내용을 준비해요.',
    action: '진료 질문 준비하기',
  },
  {
    id: 'disease-hypotheses',
    title: '질환 가능성 살펴보기',
    description:
      '앱에 있는 근거와 반대 근거, 불확실한 점과 더 필요한 정보를 함께 확인해요.',
    action: '가능성 살펴보기',
  },
  {
    id: 'rag-conversation',
    title: '건강 기록과 대화하기',
    description:
      '저장된 건강 기록을 찾아 답하고, 답의 근거가 된 원문으로 이동해요.',
    action: '기록에 질문하기',
  },
  {
    id: 'external-evidence',
    title: '의료 자료 찾아보기',
    description:
      '직접 입력한 검색어로 외부 의료 문헌을 찾아 출처와 날짜를 확인해요.',
    action: '외부 자료 검색하기',
  },
] as const;

/** Keeps feature routing with the app owner while giving each entry a clear action. */
export function FeatureEntryScreen(props: FeatureEntryScreenProps) {
  const actions = [
    props.onOpenVisitQuestions,
    props.onOpenDiseaseHypotheses,
    props.onOpenRagConversation,
    props.onOpenExternalEvidence,
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="ai-features-screen"
    >
      <Text accessibilityRole="header" style={styles.heading}>
        건강 기록으로 할 수 있는 일
      </Text>
      {features.map((feature, index) => (
        <View key={feature.id} style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {feature.title}
          </Text>
          <Text style={styles.description}>{feature.description}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={actions[index]}
            style={styles.action}
            testID={`ai-feature-${feature.id}`}
          >
            <Text style={styles.actionText}>{feature.action}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  card: {
    borderColor: '#C9D4D1',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
  description: { color: '#45524F', fontSize: 14, lineHeight: 20 },
  action: { alignSelf: 'flex-start', paddingVertical: 8 },
  actionText: { color: '#174F45', fontSize: 15, fontWeight: '700' },
});
