import { createCompactSchemaNames } from '../compactSchemaNames';
import { tabularHealthFacts } from '../tabularHealthFacts';
import type { AppleNativeSchema } from '../schema-types';
import { serializeAppleRequest } from '../serializeRequest';

function restore(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restore);
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.columns) && Array.isArray(object.rows)) {
    const omitted = JSON.stringify(object.omittedCells ?? []);
    return object.rows.map((row: unknown[], r: number) =>
      Object.fromEntries(
        (object.columns as string[]).flatMap((key, c) =>
          omitted.includes(JSON.stringify([r, c]))
            ? []
            : [[key, restore(row[c])]],
        ),
      ),
    );
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [key, restore(item)]),
  );
}

test('tabular context round-trips every source value and distinguishes omitted, null, zero and false', () => {
  const facts = {
    medications: Array.from({ length: 12 }, (_, index) => ({
      name: '합성 복약 ' + index,
      source: 'healthkit_registration',
      scheduleRegistered: false,
      taken: index,
      skipped: 0,
      otherDoseRecords: 0,
      daysWithDoseRecords: index,
      ...(index % 2 ? { firstDoseAt: null } : {}),
      lastDoseAt: '2026-10-20T08:00:00Z',
    })),
  };
  const encoded = tabularHealthFacts(facts);
  expect(restore(encoded)).toEqual(facts);
  expect(JSON.stringify(encoded).length).toBeLessThan(
    JSON.stringify(facts).length * 0.8,
  );
  expect(facts.medications[0]).not.toHaveProperty('firstDoseAt');
});

test('short native schema identities preserve fields, descriptions, enum values and type distinctions', () => {
  const compact = createCompactSchemaNames();
  const schema: AppleNativeSchema = {
    kind: 'object',
    name: 'VeryLongGeneratedAnswerField1Choice0',
    description: 'Preserve the source-kind boundary.',
    properties: [
      {
        name: 'evidenceIds',
        optional: false,
        description: 'Use actual evidence IDs.',
        schema: {
          kind: 'array',
          minimumElements: 1,
          maximumElements: 3,
          item: {
            kind: 'enum',
            name: 'VeryLongGeneratedAnswerField1Choice0Field0Item',
            values: ['evidence-1'],
          },
        },
      },
    ],
  };
  const actual = compact(schema);
  expect(actual).toEqual({
    ...schema,
    name: 'S1',
    properties: [
      {
        ...schema.properties[0],
        schema: {
          ...schema.properties[0]!.schema,
          item: { kind: 'enum', name: 'S2', values: ['evidence-1'] },
        },
      },
    ],
  });
  expect(compact(schema)).toEqual(actual);
  expect(
    compact({ kind: 'object', name: 'AnotherToolSchema', properties: [] }),
  ).toMatchObject({ name: 'S3' });
});

test('native serialization keeps authored semantic titles and distinct sibling identities', () => {
  const request = serializeAppleRequest({
    messages: [{ role: 'user', content: 'Use the supplied evidence.' }],
    responseFormat: {
      name: 'ARepeatedGeneratedAncestryName',
      schema: {
        type: 'object',
        title: 'Task response',
        properties: {
          first: {
            type: 'object',
            title: 'Evidence request',
            properties: {
              kind: {
                type: 'string',
                title: 'Response kind',
                enum: ['answer'],
              },
            },
          },
          second: { type: 'object', title: 'Evidence request', properties: {} },
        },
      },
    },
  });
  const schema = request.nativeResponseSchema;
  expect(schema?.kind).toBe('object');
  if (schema?.kind !== 'object') throw new Error('Expected object schema');
  expect(schema.name).toContain('Taskresponse');
  const first = schema.properties[0]!.schema;
  const second = schema.properties[1]!.schema;
  if (first.kind !== 'object' || second.kind !== 'object')
    throw new Error('Expected sibling object schemas');
  expect(first.name).toContain('Evidencerequest');
  expect(second.name).toContain('Evidencerequest');
  expect(first.name).not.toBe(second.name);
  expect(first.properties[0]!.schema).toMatchObject({
    name: expect.stringContaining('Responsekind'),
    values: ['answer'],
  });
});

test('numeric authored titles cannot collide with later native type indices', () => {
  const request = serializeAppleRequest({
    messages: [{ role: 'user', content: 'Use the supplied evidence.' }],
    responseFormat: {
      name: 'Answer',
      schema: {
        type: 'object',
        title: '1Record',
        properties: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [
            'field' + index,
            {
              type: 'object',
              title: index === 9 ? 'Record' : 'Section',
              properties: {
                value: { type: index === 9 ? 'string' : 'boolean' },
              },
            },
          ]),
        ),
      },
    },
  });
  const schema = request.nativeResponseSchema;
  if (schema?.kind !== 'object') throw new Error('Expected object schema');
  const names = [
    schema.name,
    ...schema.properties.map(property => {
      if (property.schema.kind !== 'object')
        throw new Error('Expected object child');
      return property.schema.name;
    }),
  ];
  expect(new Set(names).size).toBe(11);
});
