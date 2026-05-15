import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ohm from 'ohm-js';

const grammarSource = readFileSync(fileURLToPath(new URL('./permissions.ohm', import.meta.url)), 'utf8');

/**
 * Compiled Ohm grammar for the `.perm` surface syntax. The grammar source is
 * loaded from `permissions.ohm` co-located with this module (in `src/` for
 * tests, copied to `dist/` at build time).
 */
export const grammar = ohm.grammar(grammarSource);
