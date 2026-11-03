import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toUnexpected } from './errors.ts';

describe('toUnexpected', () => {
  it('wraps any thrown value as an Unexpected error carrying it as the cause', () => {
    fc.assert(
      fc.property(fc.anything(), (cause) => {
        expect(toUnexpected(cause)).toEqual({ kind: 'Unexpected', cause });
      }),
    );
  });
});
