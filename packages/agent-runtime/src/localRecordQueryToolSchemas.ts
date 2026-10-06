import {
  LOCAL_MEMORY_MAX_RESULTS,
  LOCAL_OBSERVATION_QUERY_TYPES,
  LOCAL_QUERY_MAX_ROWS,
} from './localRecordQueryService';

const timestampProperty = { type: 'string', format: 'date-time' } as const;
const rowLimitProperty = {
  type: 'integer',
  minimum: 1,
  maximum: LOCAL_QUERY_MAX_ROWS,
  default: 25,
} as const;
const rangeProperties = {
  fromInclusive: timestampProperty,
  toExclusive: timestampProperty,
  limit: rowLimitProperty,
} as const;

/** JSON Schema tool inputs keep model-callable filters finite and exclude SQL fields. */
export const localRecordQueryToolSchemas = {
  health: {
    type: 'object',
    properties: {
      ...rangeProperties,
      type: { type: 'string', enum: LOCAL_OBSERVATION_QUERY_TYPES },
    },
    required: ['fromInclusive', 'toExclusive', 'type'],
    additionalProperties: false,
  },
  range: {
    type: 'object',
    properties: rangeProperties,
    required: ['fromInclusive', 'toExclusive'],
    additionalProperties: false,
  },
  appointment: {
    type: 'object',
    properties: { afterInclusive: timestampProperty },
    required: ['afterInclusive'],
    additionalProperties: false,
  },
  transcript: {
    type: 'object',
    properties: {
      ...rangeProperties,
      recordingSourceId: { type: 'string', minLength: 1, maxLength: 512 },
    },
    required: ['recordingSourceId', 'fromInclusive', 'toExclusive'],
    additionalProperties: false,
  },
  memory: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1000 },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: LOCAL_MEMORY_MAX_RESULTS,
        default: 3,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
} as const;
