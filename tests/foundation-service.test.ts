import { afterEach, describe, expect, it } from 'vitest';

import {
  FoundationService,
  SERVER_NAME,
  SERVER_VERSION,
} from '../src/services/foundation-service.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

describe('FoundationService', () => {
  it('returns structured health information without exposing the absolute path', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);
    const service = new FoundationService({ workspaceRoot: root });

    const health = await service.healthCheck();

    expect(health).toMatchObject({
      serverName: SERVER_NAME,
      version: SERVER_VERSION,
      status: 'ok',
      nodeVersion: process.version,
      filesystemAccess: 'read-write',
      authorizedRoot: { absolutePathHidden: true },
    });
    expect(health.checkedAt).toEqual(expect.any(String));
    expect(JSON.stringify(health)).not.toContain(root);
  });

  it('reports the expected current and deferred capabilities', () => {
    const service = new FoundationService({ workspaceRoot: 'C:\\authorized-root' });

    expect(service.getServerCapabilities()).toMatchObject({
      schemaVersion: '1.0.0',
      supportedWorkItemTypes: ['USER_STORY', 'DEFECT', 'INCIDENT', 'TECHNICAL_TASK'],
      availableTools: expect.arrayContaining([
        { name: 'create_work_item', mutatesFilesystem: true },
        { name: 'initialize_work_item_documents', mutatesFilesystem: true },
        { name: 'get_work_item_document', mutatesFilesystem: false },
        { name: 'update_work_item_document', mutatesFilesystem: true },
        { name: 'refresh_ai_context', mutatesFilesystem: true },
      ]),
      notImplemented: expect.arrayContaining(['close_work_item']),
    });
  });
});
