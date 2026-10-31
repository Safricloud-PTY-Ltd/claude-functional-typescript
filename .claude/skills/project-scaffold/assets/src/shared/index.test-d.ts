import { describe, expectTypeOf, it } from 'vitest';
import type { Brand } from './index.ts';

// The barrel's type-level acceptance test: from its own module it imports nothing but the barrel,
// so dropping the public Brand re-export fails here.
describe('shared barrel types', () => {
  it('exports Brand, which keeps distinct names apart and stays assignable to its primitive', () => {
    expectTypeOf<Brand<string, 'OrderId'>>().not.toExtend<Brand<string, 'CustomerId'>>();
    expectTypeOf<string>().not.toExtend<Brand<string, 'OrderId'>>();
    expectTypeOf<Brand<string, 'OrderId'>>().toExtend<string>();
  });
});
