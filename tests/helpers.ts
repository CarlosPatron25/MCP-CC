import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function createTemporaryWorkspaceRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ws-workspace-mcp-'));
}

export async function removeTemporaryWorkspaceRoot(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
