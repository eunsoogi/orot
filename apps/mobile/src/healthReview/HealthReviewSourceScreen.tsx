import { EvidenceSourceDetailScreen } from '../aiFeatures/integration/EvidenceSourceDetailScreen';
import { AppText as Text } from '../layout/AppText';
import { useHealthReviewSession } from './HealthReviewSession';

/** Citation navigation reuses the original viewer with the invocation that produced this exact alias. */
export function HealthReviewSourceScreen({ onBack }: { onBack: () => void }) {
  const { citation } = useHealthReviewSession();
  if (!citation)
    return <Text accessibilityRole="alert">근거를 불러올 수 없어요.</Text>;
  return (
    <EvidenceSourceDetailScreen
      reference={citation.reference}
      readSource={citation.readSource}
      onBack={onBack}
    />
  );
}
