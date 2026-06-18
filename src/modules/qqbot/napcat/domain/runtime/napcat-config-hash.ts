import { createHash } from 'crypto';

/**
 * Produces a deterministic JSON hash for NapCat and OneBot config snapshots.
 * @param value - Config value that may contain nested plain objects or arrays.
 * @returns SHA-256 digest of the stable JSON representation.
 */
export function stableJsonHash(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * Serializes config objects with stable object-key ordering.
 * @param value - JSON-compatible value written to NapCat config evidence.
 * @returns JSON string whose object key order is deterministic.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

/**
 * Recursively sorts plain-object keys while preserving array order.
 * @param value - JSON-compatible value to normalize before hashing.
 * @returns Normalized value with deterministic object key order.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortJsonValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}
