/**
 * Encode an SVG string as a `data:image/svg+xml;base64,…` URI, suitable for
 * inlining an avatar directly into an `src`/`href` attribute.
 *
 * @param svg - The SVG markup to encode.
 * @returns A base64 data URI for the SVG.
 *
 * @example
 * ```typescript
 * toDataUri(generateAvatar('user-123')); // "data:image/svg+xml;base64,..."
 * ```
 */
export const toDataUri = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
