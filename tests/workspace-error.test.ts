import { describe, expect, it } from 'vitest';

import { PathSecurityError, toStructuredError } from '../src/errors/workspace-error.js';

describe('toStructuredError', () => {
  it('serializes known errors with a stable code', () => {
    expect(toStructuredError(new PathSecurityError('Denied.'))).toEqual({
      error: {
        code: 'PATH_OUTSIDE_WORKSPACE',
        message: 'Denied.',
      },
    });
  });

  it('does not leak details for unexpected errors', () => {
    expect(toStructuredError(new Error('internal stack detail'))).toEqual({
      error: {
        code: 'UNEXPECTED_ERROR',
        message: 'An unexpected error occurred while processing the request.',
      },
    });
  });
});
