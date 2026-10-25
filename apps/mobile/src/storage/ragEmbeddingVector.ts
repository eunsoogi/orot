import type { LocalEmbeddingModelIdentity } from '@orot/rag';
import type { SqlValue } from '@orot/storage';

export function validateVector(
  model: LocalEmbeddingModelIdentity,
  vector: readonly number[],
): void {
  if (
    vector.length !== model.dimension ||
    vector.some(value => !Number.isFinite(value))
  ) {
    throw new Error(
      'Embedding vector does not match the stored model dimension.',
    );
  }
}

/** Encodes model output as the little-endian float32 blob stored by SQLCipher. */
export function encodeVector(vector: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(vector.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  vector.forEach((value, index) => {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true);
  });
  return bytes;
}

function decodeBytes(value: SqlValue | undefined): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('The encrypted embedding row has no binary vector.');
}

/** Decodes a fixed-dimension model vector from its SQLCipher blob. */
export function decodeVector(
  value: SqlValue | undefined,
  dimension: number,
): number[] {
  const bytes = decodeBytes(value);
  if (bytes.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(
      'The encrypted embedding row has an invalid vector length.',
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: dimension }, (_, index) =>
    view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true),
  );
}
