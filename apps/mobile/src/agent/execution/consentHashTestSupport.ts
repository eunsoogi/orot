declare const require: (specifier: string) => unknown;

// Node's independent implementation supplies expected SHA-256 values for receipt tests.
export const { createHash } = require('node:crypto') as {
  createHash(algorithm: string): {
    update(value: string): { digest(encoding: 'hex'): string };
  };
};
