import type { ResearchArtifact } from '../../storage/researchArtifactStorage';
import type { EvidenceSourceDetailSection } from './evidenceSourcePresentation';

/** Present public citation metadata and generated web text with their distinct limits. */
export function presentResearchSource(
  research: ResearchArtifact,
): readonly EvidenceSourceDetailSection[] {
  return [
    {
      title: '이전에 찾은 공개 연구 자료',
      rows: [
        { label: '가져온 시각', value: research.createdAt },
        {
          label: '출처 상태',
          value: '저장 당시의 공개 출처이며 현재 상태는 확인되지 않음',
        },
        {
          label: '주의',
          value:
            research.source.kind === 'publication'
              ? '문헌 메타데이터만 저장되었으며 초록 원문은 저장되지 않았습니다.'
              : '공개 웹검색에 대한 AI 설명이며 원문이나 검증된 의료 사실이 아닙니다.',
        },
      ],
      hero: {
        heading:
          research.source.kind === 'publication'
            ? research.source.title
            : '공개 웹검색 설명',
        body: research.generatedText ?? '',
        consumedLabels: [],
      },
    },
  ];
}
