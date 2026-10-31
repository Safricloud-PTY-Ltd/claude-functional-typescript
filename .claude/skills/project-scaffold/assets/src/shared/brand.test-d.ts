import { describe, expectTypeOf, it } from 'vitest';
import type { Brand } from './brand.ts';

type OrderId = Brand<string, 'OrderId'>;
type CustomerId = Brand<string, 'CustomerId'>;
type Quantity = Brand<number, 'OrderId'>;

describe('Brand', () => {
  it('keeps two brands over the same primitive apart in both directions', () => {
    expectTypeOf<OrderId>().not.toExtend<CustomerId>();
    expectTypeOf<CustomerId>().not.toExtend<OrderId>();
  });

  it('keeps one brand name over two primitives apart', () => {
    expectTypeOf<Quantity>().not.toExtend<OrderId>();
    expectTypeOf<OrderId>().not.toExtend<Quantity>();
  });

  it('does not accept a plain primitive where the branded type is expected', () => {
    expectTypeOf<string>().not.toExtend<OrderId>();
    expectTypeOf<number>().not.toExtend<Quantity>();
  });

  it('remains assignable to its underlying primitive', () => {
    expectTypeOf<OrderId>().toExtend<string>();
    expectTypeOf<Quantity>().toExtend<number>();
  });

  it('carries its name as a literal in the brand field', () => {
    expectTypeOf<OrderId['__brand']>().toEqualTypeOf<'OrderId'>();
  });
});
