import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';

const MARKER_PREFIX = '<!-- WS-WORKSPACE-MCP:M5_V2_BOOTSTRAP ';
const MARKER_PATTERN =
  /^<!-- WS-WORKSPACE-MCP:M5_V2_BOOTSTRAP schemaVersion=1\.0\.0 status=(PENDING|COMPLETE) requestFingerprint=([a-f0-9]{64}) -->$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

const activeBootstrapAccess = new AsyncLocalStorage<ReadonlyMap<string, string>>();

export type WorkItemV2BootstrapMarkerInspection =
  | { kind: 'ABSENT' }
  | { kind: 'INVALID' }
  | {
      kind: 'VALID';
      status: 'PENDING' | 'COMPLETE';
      requestFingerprint: string;
      marker: string;
    };

export type WorkItemV2BootstrapAccessDecision = 'ALLOW' | 'DENY_PENDING' | 'INVALID';

function bootstrapAccessKey(workspaceRoot: string, workItemId: string): string {
  return `${resolve(workspaceRoot)}\u0000${workItemId}`;
}

/**
 * Grants access to one PENDING dossier only within the exact asynchronous
 * bootstrap call chain that owns its persisted request fingerprint.
 */
export function withWorkItemV2BootstrapAccess<Result>(
  workspaceRoot: string,
  workItemId: string,
  requestFingerprint: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  if (!FINGERPRINT_PATTERN.test(requestFingerprint)) {
    throw new Error('The Work Item v2 bootstrap fingerprint is invalid.');
  }
  const key = bootstrapAccessKey(workspaceRoot, workItemId);
  const inherited = activeBootstrapAccess.getStore();
  const existing = inherited?.get(key);
  if (existing !== undefined && existing !== requestFingerprint) {
    throw new Error('A different Work Item v2 bootstrap scope is already active.');
  }
  const active = new Map(inherited ?? []);
  active.set(key, requestFingerprint);
  return activeBootstrapAccess.run(active, operation);
}

/**
 * COMPLETE and historical manifests are public. PENDING is accessible only
 * from the exact scoped bootstrap; malformed owned markers fail closed.
 */
export function workItemV2BootstrapAccessDecision(
  workspaceRoot: string,
  workItemId: string,
  manifest: string,
): WorkItemV2BootstrapAccessDecision {
  const inspected = inspectWorkItemV2BootstrapMarker(manifest);
  if (inspected.kind === 'INVALID') {
    return 'INVALID';
  }
  if (inspected.kind !== 'VALID' || inspected.status === 'COMPLETE') {
    return 'ALLOW';
  }
  return activeBootstrapAccess.getStore()?.get(bootstrapAccessKey(workspaceRoot, workItemId)) ===
    inspected.requestFingerprint
    ? 'ALLOW'
    : 'DENY_PENDING';
}

export function renderWorkItemV2BootstrapMarker(
  status: 'PENDING' | 'COMPLETE',
  requestFingerprint: string,
): string {
  return `${MARKER_PREFIX}schemaVersion=1.0.0 status=${status} requestFingerprint=${requestFingerprint} -->`;
}

export function inspectWorkItemV2BootstrapMarker(
  manifest: string,
): WorkItemV2BootstrapMarkerInspection {
  const candidates = manifest.split(/\r?\n/gu).filter((line) => line.startsWith(MARKER_PREFIX));
  if (candidates.length === 0) {
    return { kind: 'ABSENT' };
  }
  if (candidates.length !== 1) {
    return { kind: 'INVALID' };
  }
  const marker = candidates[0]!;
  const match = MARKER_PATTERN.exec(marker);
  if (match === null) {
    return { kind: 'INVALID' };
  }
  return {
    kind: 'VALID',
    status: match[1] as 'PENDING' | 'COMPLETE',
    requestFingerprint: match[2]!,
    marker,
  };
}

export function completeWorkItemV2BootstrapMarker(manifest: string): {
  valid: boolean;
  manifest: string;
} {
  const inspected = inspectWorkItemV2BootstrapMarker(manifest);
  if (inspected.kind === 'INVALID') {
    return { valid: false, manifest };
  }
  if (inspected.kind !== 'VALID' || inspected.status === 'COMPLETE') {
    return { valid: true, manifest };
  }
  return {
    valid: true,
    manifest: manifest.replace(
      inspected.marker,
      renderWorkItemV2BootstrapMarker('COMPLETE', inspected.requestFingerprint),
    ),
  };
}
