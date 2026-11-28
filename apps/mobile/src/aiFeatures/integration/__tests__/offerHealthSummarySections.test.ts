import { offerHealthSummarySections } from '../offerHealthSummarySections';

test('offers every section in order, with no second truncation beyond the stock archive decoder', () => {
  const offer = offerHealthSummarySections(
    'Please retain the final part.',
    Array.from({ length: 9 }, (_, index) => ({
      title: 'Synthetic section ' + index,
      summary: 'Synthetic text ' + index,
      uncertainty: '',
      missingData: [],
    })),
  );
  const last = 'section_9';
  const result = (slot: string) =>
    offer.selectedOrdinal({
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'fixture',
          name: 'remember-health-summary-section',
          arguments: { slot },
        },
      ],
    });
  expect(offer.payload.tools?.[0]?.inputSchema).toMatchObject({
    properties: {
      slot: {
        enum: Array.from({ length: 9 }, (_, index) => 'section_' + (index + 1)),
      },
    },
  });
  expect(result(last)).toBe(8);
  expect(result('section_10')).toBe(-1);
  expect(JSON.stringify(offer.payload)).toContain('Synthetic text 8');
});
