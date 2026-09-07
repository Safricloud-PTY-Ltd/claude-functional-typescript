/**
 * The failure a contract stub raises when called before it is implemented.
 */
export type NotImplemented = { readonly kind: 'NotImplemented'; readonly name: string };

/**
 * Body of every unimplemented contract. Throws, so that a stub satisfies any return
 * type and its tests stay red until an implementor replaces it. The contract's
 * parameters are passed through so the unused-variable rule stays on.
 *
 * @param name - The function the stub stands in for, for the failure message.
 * @param _args - The contract's parameters; ignored.
 * @throws Error carrying a `NotImplemented` cause; always.
 */
export const stub = (name: string, ..._args: ReadonlyArray<unknown>): never => {
  const failure: NotImplemented = { kind: 'NotImplemented', name };
  throw new Error(`NotImplemented: ${failure.name}`, { cause: failure });
};
