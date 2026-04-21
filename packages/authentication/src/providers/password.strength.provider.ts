import { Injectable } from 'injectkit';
import { zxcvbnAsync, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';
import { matcherPwnedFactory } from '@zxcvbn-ts/matcher-pwned';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Evaluates password strength using [zxcvbn-ts](https://zxcvbn-ts.github.io/zxcvbn/)
 * with the English dictionary, common adjacency graphs, and a HaveIBeenPwned leak check.
 *
 * Scores range from 0 (very weak) to 4 (very strong). A score of 3 or higher is
 * considered acceptable by {@link ensureStrength}.
 */
@Injectable()
export class PasswordStrengthProvider {
  constructor() {
    const options = {
      translations: zxcvbnEnPackage.translations,
      graphs: zxcvbnCommonPackage.adjacencyGraphs,
      dictionary: {
        ...zxcvbnCommonPackage.dictionary,
        ...zxcvbnEnPackage.dictionary,
      },
    };

    const matcherPwned = matcherPwnedFactory(fetch, zxcvbnOptions);
    zxcvbnOptions.setOptions(options);
    if (!zxcvbnOptions.matchers['pwned']) {
      zxcvbnOptions.addMatcher('pwned', matcherPwned);
    }
  }

  /**
   * Evaluate the strength of a password without throwing.
   * @param password    - The password to evaluate.
   * @param userInputs  - Additional strings or numbers to penalise if found in the password
   *   (e.g. the user's name, email, or date of birth).
   * @returns An object with `valid` (score ≥ 3), `score` (0–4), and zxcvbn `feedback`.
   */
  async checkStrength(password: string, ...userInputs: (string | number)[]) {
    const result = await zxcvbnAsync(password, userInputs);

    return {
      valid: result.score >= 3,
      score: result.score,
      feedback: result.feedback,
    };
  }

  /**
   * Assert that a password meets the minimum strength threshold (score ≥ 3).
   * @param password   - The password to evaluate.
   * @param userInputs - Additional context values to penalise (see {@link checkStrength}).
   * @throws HTTP 400 with `{ password: [warning, ...suggestions] }` details when the score is below 3.
   */
  async ensureStrength(password: string, ...userInputs: (string | number)[]) {
    const result = await this.checkStrength(password, ...userInputs);

    if (!result.valid) {
      throw httpError(400).withDetails({ password: [result.feedback.warning, ...result.feedback.suggestions] });
    }
  }
}
