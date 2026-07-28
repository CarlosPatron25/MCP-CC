import { describe, expect, it } from 'vitest';

import type { WorkItem } from '../src/domain/work-item.js';
import { DocumentUpdateError } from '../src/errors/workspace-error.js';
import { parsePersistedWorkItem } from '../src/filesystem/local-filesystem-work-item-dossier-repository.js';
import { serializeWorkItemYml } from '../src/services/work-item-creation-service.js';

const historicalWorkItem: WorkItem = {
  schemaVersion: '1.0.0',
  id: 'US-123',
  rallyId: 'US-123',
  type: 'USER_STORY',
  status: 'DRAFT',
  title: 'Historical Work Item',
  dates: {
    startedAt: '2026-07-20',
  },
  salesforce: {
    developmentAlias: 'historical',
  },
  functional: {
    definition: 'Preserve the historical v1 dossier.',
    acceptanceCriteria: [],
  },
  initialScope: {
    relatedComponents: [],
  },
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
};

const versionTwoWorkItem: WorkItem = {
  ...historicalWorkItem,
  schemaVersion: '2.0.0',
  iteration: {
    iterationId: 'Sprint 2026.07',
    displayName: 'Sprint de julio',
    storageToken: 'Sprint_2026.07',
  },
};

function expectCorrupt(content: string, field: string): void {
  expect(() => parsePersistedWorkItem(content)).toThrow(DocumentUpdateError);
  try {
    parsePersistedWorkItem(content);
  } catch (error) {
    expect(error).toMatchObject({
      code: 'DOCUMENT_UPDATE_FAILED',
      details: { field },
    });
  }
}

describe('WORK_ITEM.yml codec', () => {
  it('reads a historical v1 dossier without adding or requiring iteration', () => {
    const validHistoricalVariant: WorkItem = {
      ...historicalWorkItem,
      rallyId: 'US 123',
    };
    const content = serializeWorkItemYml(validHistoricalVariant);

    expect(parsePersistedWorkItem(content)).toEqual(validHistoricalVariant);
  });

  it('reads a complete strict v2 iteration', () => {
    const content = serializeWorkItemYml(versionTwoWorkItem);

    expect(parsePersistedWorkItem(content)).toEqual(versionTwoWorkItem);
  });

  it.each([
    {
      name: 'top-level key',
      field: 'title',
      mutate: (content: string) =>
        content.replace(
          'title: "Historical Work Item"',
          'title: "Historical Work Item"\ntitle: "Hidden duplicate"',
        ),
    },
    {
      name: 'nested key',
      field: 'dates.startedAt',
      mutate: (content: string) =>
        content.replace(
          '  startedAt: "2026-07-20"',
          '  startedAt: "2026-07-20"\n  startedAt: "2026-07-21"',
        ),
    },
  ])('rejects a duplicated YAML $name', ({ field, mutate }) => {
    expectCorrupt(mutate(serializeWorkItemYml(historicalWorkItem)), field);
  });

  it.each([
    {
      name: 'top-level field',
      field: 'unexpected',
      mutate: (content: string) => `${content.trimEnd()}\nunexpected: "hidden"\n`,
    },
    {
      name: 'nested governed field',
      field: 'dates.unexpected',
      mutate: (content: string) =>
        content.replace(
          '  startedAt: "2026-07-20"',
          '  startedAt: "2026-07-20"\n  unexpected: "hidden"',
        ),
    },
    {
      name: 'strict v2 iteration field',
      field: 'iteration.unexpected',
      mutate: (content: string) =>
        content.replace(
          '  storageToken: "Sprint_2026.07"',
          '  storageToken: "Sprint_2026.07"\n  unexpected: "hidden"',
        ),
      workItem: versionTwoWorkItem,
    },
  ])('rejects an unknown $name', ({ field, mutate, workItem = historicalWorkItem }) => {
    expectCorrupt(mutate(serializeWorkItemYml(workItem)), field);
  });

  it('rejects v2 without iteration', () => {
    const content = serializeWorkItemYml(historicalWorkItem).replace(
      'schemaVersion: "1.0.0"',
      'schemaVersion: "2.0.0"',
    );

    expectCorrupt(content, 'iteration');
  });

  it('rejects the v2-only iteration map when the document declares v1', () => {
    const content = serializeWorkItemYml(versionTwoWorkItem).replace(
      'schemaVersion: "2.0.0"',
      'schemaVersion: "1.0.0"',
    );

    expectCorrupt(content, 'iteration');
  });

  it.each([
    ['iterationId', '  iterationId: "Sprint 2026.07"\n', 'iteration.iterationId'],
    ['storageToken', '  storageToken: "Sprint_2026.07"\n', 'iteration.storageToken'],
  ])('rejects v2 with incomplete iteration missing %s', (_name, line, field) => {
    const content = serializeWorkItemYml(versionTwoWorkItem).replace(line, '');

    expectCorrupt(content, field);
  });

  it.each([
    ['a traversal token', '../outside'],
    ['a non-canonical token', 'Different_Sprint'],
    ['a path separator', 'Sprint/2026.07'],
    ['a dot segment', '..'],
  ])('rejects v2 storageToken with %s', (_name, storageToken) => {
    const content = serializeWorkItemYml(versionTwoWorkItem).replace(
      '  storageToken: "Sprint_2026.07"',
      `  storageToken: ${JSON.stringify(storageToken)}`,
    );

    expectCorrupt(content, 'iteration.storageToken');
  });

  it.each([
    ['an impossible startedAt', 'startedAt', '2026-02-30', 'dates.startedAt'],
    [
      'a non-canonical plannedCompletionAt',
      'plannedCompletionAt',
      '2026-7-21',
      'dates.plannedCompletionAt',
    ],
    [
      'plannedCompletionAt before startedAt',
      'plannedCompletionAt',
      '2026-07-19',
      'dates.plannedCompletionAt',
    ],
    [
      'actualCompletionAt before startedAt',
      'actualCompletionAt',
      '2026-07-19',
      'dates.actualCompletionAt',
    ],
  ])('rejects %s', (_name, key, value, field) => {
    const workItem: WorkItem = {
      ...historicalWorkItem,
      dates: {
        ...historicalWorkItem.dates,
        ...(key === 'plannedCompletionAt' ? { plannedCompletionAt: '2026-07-21' } : {}),
        ...(key === 'actualCompletionAt' ? { actualCompletionAt: '2026-07-21' } : {}),
      },
    };
    const content = serializeWorkItemYml(workItem).replace(
      `  ${key}: ${JSON.stringify(workItem.dates[key as keyof WorkItem['dates']])}`,
      `  ${key}: ${JSON.stringify(value)}`,
    );

    expectCorrupt(content, field);
  });

  it.each([
    ['createdAt without canonical milliseconds', 'createdAt', '2026-07-20T10:00:00Z', 'createdAt'],
    ['an impossible updatedAt', 'updatedAt', '2026-02-30T10:00:00.000Z', 'updatedAt'],
    ['updatedAt before createdAt', 'updatedAt', '2026-07-20T09:59:59.999Z', 'updatedAt'],
  ])('rejects %s', (_name, key, value, field) => {
    const content = serializeWorkItemYml(historicalWorkItem).replace(
      `${key}: ${JSON.stringify(historicalWorkItem[key as 'createdAt' | 'updatedAt'])}`,
      `${key}: ${JSON.stringify(value)}`,
    );

    expectCorrupt(content, field);
  });

  it.each([
    ['a lowercase internal ID', 'id: "US-123"', 'id: "us-123"', 'id'],
    ['a traversal-shaped internal ID', 'id: "US-123"', 'id: "../US-123"', 'id'],
    ['an empty external Rally ID', 'rallyId: "US-123"', 'rallyId: "   "', 'rallyId'],
    [
      'a control character in the Rally ID',
      'rallyId: "US-123"',
      'rallyId: "US\\u0000-123"',
      'rallyId',
    ],
    [
      'a non-canonical iteration ID',
      '  iterationId: "Sprint 2026.07"',
      '  iterationId: " Sprint 2026.07 "',
      'iteration.iterationId',
    ],
  ])('rejects %s', (_name, original, replacement, field) => {
    const workItem = field === 'iteration.iterationId' ? versionTwoWorkItem : historicalWorkItem;
    const content = serializeWorkItemYml(workItem).replace(original, replacement);

    expectCorrupt(content, field);
  });
});
