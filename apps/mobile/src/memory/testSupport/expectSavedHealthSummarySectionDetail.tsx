import { render, screen } from '@testing-library/react-native';
import { SavedGeneratedReportDetail } from '../SavedGeneratedReportDetail';

const current = () => true;

/** Exercise the existing Records → Memory detail, not the SQL value alone. */
export async function expectSavedHealthSummarySectionDetail(
  id: string,
  section: { title: string; summary: string },
  excluded: string,
) {
  const detail = await render(
    <SavedGeneratedReportDetail
      artifactId={id}
      reportKind="health_summary_section"
      isReadCurrent={current}
    />,
  );
  try {
    expect(await screen.findByText(section.title)).toBeTruthy();
    expect(screen.getByText(section.summary)).toBeTruthy();
    expect(screen.queryByText(excluded)).toBeNull();
  } finally {
    await detail.unmount();
  }
}
