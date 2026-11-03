/**
 * A nominal wrapper over a primitive so that ids of different kinds cannot be mixed.
 *
 * @example
 *   type OrderId = Brand<string, 'OrderId'>;
 */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
