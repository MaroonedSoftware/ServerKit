import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { RateLimiterAbstract } from 'rate-limiter-flexible';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { PasswordFactorRepository, PasswordValue } from './password.factor.repository.js';
import { zxcvbnAsync, zxcvbnOptions } from '@zxcvbn-ts/core';
import { matcherPwnedFactory } from '@zxcvbn-ts/matcher-pwned';
import zxcvbnEnPackage from '@zxcvbn-ts/language-en';
import zxcvbnCommonPackage from '@zxcvbn-ts/language-common';

@Injectable()
export class PasswordFactorService {
  constructor(
    private readonly passwordFactorRepository: PasswordFactorRepository,
    private readonly rateLimiter: RateLimiterAbstract,
  ) {
    const matcherPwned = matcherPwnedFactory(fetch, zxcvbnOptions);
    zxcvbnOptions.setOptions({
      translations: zxcvbnEnPackage.translations,
      graphs: zxcvbnCommonPackage.adjacencyGraphs,
      dictionary: {
        ...zxcvbnCommonPackage.dictionary,
        ...zxcvbnEnPackage.dictionary,
      },
    });
    if (!zxcvbnOptions.matchers['pwned']) {
      zxcvbnOptions.addMatcher('pwned', matcherPwned);
    }
  }

  async checkStrength(password: string, ...userInputs: (string | number)[]) {
    const result = await zxcvbnAsync(password, userInputs);

    if (result.score < 3) {
      throw httpError(400).withDetails({
        password: result.feedback.warning,
        suggestions: result.feedback.suggestions,
      });
    }
  }

  private hashPassword(password: string, salt?: Buffer): PasswordValue {
    salt ??= crypto.randomBytes(32);
    const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512');
    return { hash: hash.toString('base64'), salt: salt.toString('base64') };
  }

  private comparePassword(password: string, hash: string, salt: string) {
    const saltBuffer = Buffer.from(salt, 'base64');
    const hashPwd = crypto.pbkdf2Sync(password, saltBuffer, 210000, 64, 'sha512');
    return hashPwd.toString('base64') === hash;
  }

  async createPasswordFactor(actorId: string, password: string, needsReset: boolean = false) {
    await this.checkStrength(password);

    const existingFactor = await this.passwordFactorRepository.getFactor(actorId);
    if (existingFactor) {
      throw httpError(409).withDetails({ actorId: 'Password factor already exists' });
    }

    const value = this.hashPassword(password);
    const factor = await this.passwordFactorRepository.createFactor(actorId, value, needsReset);
    return factor.id;
  }

  async updatePasswordFactor(actorId: string, password: string, needsReset: boolean = false) {
    await this.checkStrength(password);

    let factor = await this.passwordFactorRepository.getFactor(actorId);
    if (!factor) {
      throw httpError(404).withDetails({ actorId: 'Password factor not found' });
    }

    const previousPasswords = await this.passwordFactorRepository.listPreviousPasswords(actorId, 10);
    if (previousPasswords.some(p => this.comparePassword(password, p.hash, p.salt))) {
      throw httpError(400).withDetails({ password: 'Password is the same as a previous one' });
    }
    factor = await this.passwordFactorRepository.updateFactor(actorId, this.hashPassword(password), needsReset);
    return factor.id;
  }

  async deleteFactor(actorId: string) {
    await this.passwordFactorRepository.deleteFactor(actorId);
  }

  async verifyPassword(actorId: string, password: string) {
    try {
      await this.rateLimiter.consume(actorId);
    } catch (error) {
      throw httpError(429).withInternalDetails({ message: `password authentication has been rate limited for actor: ${actorId}` });
    }

    const passwordFactor = await this.passwordFactorRepository.getFactor(actorId);

    if (!passwordFactor || !passwordFactor.active) {
      throw unauthorizedError('Bearer error="invalid_factor"').withInternalDetails({ message: `${actorId} missing active password factor` });
    }

    if (passwordFactor.needsReset) {
      throw unauthorizedError('Bearer error="reset_password"').withInternalDetails({ message: `${actorId} needs to reset password` });
    }

    if (!this.comparePassword(password, passwordFactor.value.hash, passwordFactor.value.salt)) {
      throw unauthorizedError('Bearer error="invalid_credentials"').withInternalDetails({ message: `${actorId} invalid password attempt` });
    }

    await this.rateLimiter.reward(actorId);
    return passwordFactor.id;
  }

  async changePassword(actorId: string, password: string) {
    await this.checkStrength(password);

    const passwordFactor = await this.passwordFactorRepository.getFactor(actorId);
    if (!passwordFactor) {
      throw httpError(404).withDetails({ actorId: 'Password factor not found' });
    }

    const value = this.hashPassword(password);
    const updatedFactor = await this.passwordFactorRepository.updateFactor(actorId, value, false);
    return updatedFactor.id;
  }
}
