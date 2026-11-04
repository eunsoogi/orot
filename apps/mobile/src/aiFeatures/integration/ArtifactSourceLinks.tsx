import { Alert, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import { AppText as Text } from '../../layout/AppText';
import { ConversationSources } from '../../ragConversation/ConversationSources';

/** Keep supporting and contrary sources attached to their original generated section. */
export function ArtifactSourceLinks({
  analysis,
  onOpen,
}: {
  readonly analysis: DiseaseHypothesisAnalysis;
  readonly onOpen: (reference: EvidenceReference) => void;
}) {
  return analysis.hypotheses.map((section, index) => (
    <View key={`${section.title}-${index}`}>
      <Text>{section.title}</Text>
      {section.supportingEvidence.length ? (
        <>
          <Text>사용한 출처</Text>
          <ConversationSources
            references={section.supportingEvidence}
            onOpenSource={onOpen}
            onLinkError={() => Alert.alert('출처를 열 수 없어요.')}
          />
        </>
      ) : null}
      {section.contraryEvidence.length ? (
        <>
          <Text>반대 근거</Text>
          <ConversationSources
            references={section.contraryEvidence}
            onOpenSource={onOpen}
            onLinkError={() => Alert.alert('출처를 열 수 없어요.')}
          />
        </>
      ) : null}
    </View>
  ));
}

/** Prior conversation sources remain linked to the validated saved parent. */
export function ConversationArtifactSourceLinks({
  sources,
  onOpen,
}: {
  readonly sources: readonly EvidenceReference[];
  readonly onOpen: (reference: EvidenceReference) => void;
}) {
  return (
    <ConversationSources
      references={sources}
      onOpenSource={onOpen}
      onLinkError={() => Alert.alert('출처를 열 수 없어요.')}
    />
  );
}
