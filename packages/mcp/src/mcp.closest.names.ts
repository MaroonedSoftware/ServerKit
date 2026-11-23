/** How many near names an unknown tool name is answered with. */
export const MCP_CLOSEST_NAMES_LIMIT = 3;

/** The edits (insert, delete, or substitute one character) that turn `a` into `b`. */
const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitute = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

/** The lowercase words of a tool name, split on underscores and any other non-word character. */
const wordsOf = (name: string): Set<string> =>
  new Set(
    name
      .toLowerCase()
      .split(/[_\W]+/)
      .filter(Boolean),
  );

/**
 * The names in `names` nearest to `wanted`, a tool name a model guessed, nearest
 * first and at most `limit`. A name qualifies when it shares an underscore-separated
 * word with `wanted` (`read_channels` and `list_channels`) or is a few edits from it
 * (`read_channel`): at most 2, or a third of the longer name. A name that is
 * neither is no help, so the answer may be empty.
 *
 * Ranked by edit distance less two per shared word, then alphabetically.
 *
 * @example
 * ```ts
 * closestMcpNames('list_channel', ['list_channels', 'send_message', 'read_channel']);
 * // ['list_channels', 'read_channel']
 * ```
 */
export const closestMcpNames = (wanted: string, names: Iterable<string>, limit = MCP_CLOSEST_NAMES_LIMIT): string[] => {
  const words = wordsOf(wanted);
  const lower = wanted.toLowerCase();
  return [...names]
    .map(name => {
      const distance = editDistance(lower, name.toLowerCase());
      const shared = [...wordsOf(name)].filter(word => words.has(word)).length;
      return { name, distance, shared, score: distance - 2 * shared };
    })
    .filter(({ name, distance, shared }) => shared > 0 || distance <= Math.max(2, Math.floor(Math.max(name.length, wanted.length) / 3)))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name }) => name);
};

/**
 * The text a call to an unregistered tool answers with: the name it asked for and
 * the {@link closestMcpNames} among `names`, so the model can retry with a real one.
 */
export const unknownMcpToolMessage = (wanted: string, names: Iterable<string>): string => {
  const closest = closestMcpNames(wanted, names);
  if (closest.length === 0) return `No tool named "${wanted}". List the tools to see which ones there are.`;
  return `No tool named "${wanted}". The closest: ${closest.join(', ')}. Call one of those instead.`;
};
