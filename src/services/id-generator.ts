import { randomUUID } from 'node:crypto';

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Injectable internal-identity source used by deterministic domain tests. */
export interface IdGenerator {
  generate(): string;
}

/** Production UUID v4 generator required by the Milestone 4 contract. */
export class SystemIdGenerator implements IdGenerator {
  public generate(): string {
    return randomUUID();
  }
}

export function isCanonicalUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}
