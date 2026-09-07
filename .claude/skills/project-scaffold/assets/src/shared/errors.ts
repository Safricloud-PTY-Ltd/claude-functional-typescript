/**
 * The error kind for failures nobody planned for: a thrown exception at the shell
 * edge, a rejected promise from a library, a broken invariant.
 */
export type Unexpected = { readonly kind: 'Unexpected'; readonly cause: unknown };

/**
 * Wraps anything thrown or rejected into an `Unexpected` error value.
 *
 * @param cause - Whatever was thrown or rejected.
 * @returns An `Unexpected` carrying the cause.
 */
export const toUnexpected = (cause: unknown): Unexpected => ({ kind: 'Unexpected', cause });
