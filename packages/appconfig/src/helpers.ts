/**
 * Attempts to parse a string as JSON, returning the original string if parsing fails.
 *
 * @param text - The text to parse.
 * @returns The parsed JSON value, or the original text if parsing fails.
 */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text, (_, value) => value);
  } catch (error) {
    return text;
  }
}
