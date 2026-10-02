import { describe, expect, it } from '@jest/globals';
import { validContracts } from './fixtures';

describe('provider-neutral domain contracts', () => {
  it.each(validContracts)('%s accepts a complete record', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });
});
