import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromThrowable } from 'neverthrow';
import { stub, toUnexpected } from './index.ts';

// The module's acceptance test: it imports only the barrel, as every index.test.ts does.
describe('shared barrel', () => {
  it('exports toUnexpected, which wraps any cause as an Unexpected error', () => {
    fc.assert(
      fc.property(fc.anything(), (cause) => {
        expect(toUnexpected(cause)).toEqual({ kind: 'Unexpected', cause });
      }),
    );
  });

  it('exports stub, which throws an Error whose cause is NotImplemented naming the contract', () => {
    const result = fromThrowable(stub)('lineTotal', 1, 2);
    const error = result.isErr() ? result.error : undefined;
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').toBe('NotImplemented: lineTotal');
    expect(error instanceof Error ? error.cause : undefined).toEqual({
      kind: 'NotImplemented',
      name: 'lineTotal',
    });
  });
});
