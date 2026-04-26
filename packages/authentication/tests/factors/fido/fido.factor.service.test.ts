import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  FidoFactorService,
  FidoFactorServiceOptions,
  type PublicKeyCredentialWithAttestation,
  type PublicKeyCredentialWithAssertion,
  type RegisterFidoFactorOptions,
  type AuthorizeFidoFactorOptions,
} from '../../../src/factors/fido/fido.factor.service.js';
import type { FidoFactorRepository, FidoFactor } from '../../../src/factors/fido/fido.factor.repository.js';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { Duration } from 'luxon';

// ---------------------------------------------------------------------------
// Minimal CBOR encoder (subset sufficient for COSE keys + attestation objects)
// ---------------------------------------------------------------------------

const cborInt = (n: number): Buffer => {
  if (n >= 0) {
    if (n <= 23) return Buffer.from([n]);
    if (n <= 0xff) return Buffer.from([0x18, n]);
    throw new Error('cborInt: value too large for test helper');
  }
  const v = -1 - n;
  if (v <= 23) return Buffer.from([0x20 + v]);
  if (v <= 0xff) return Buffer.from([0x38, v]);
  throw new Error('cborInt: value too negative for test helper');
};

const cborText = (s: string): Buffer => {
  const buf = Buffer.from(s, 'utf8');
  const len = buf.length;
  if (len <= 23) return Buffer.concat([Buffer.from([0x60 + len]), buf]);
  if (len <= 0xff) return Buffer.concat([Buffer.from([0x78, len]), buf]);
  throw new Error('cborText: too long for test helper');
};

const cborBytes = (b: Buffer): Buffer => {
  const len = b.length;
  if (len <= 23) return Buffer.concat([Buffer.from([0x40 + len]), b]);
  if (len <= 0xff) return Buffer.concat([Buffer.from([0x58, len]), b]);
  if (len <= 0xffff) {
    const header = Buffer.alloc(3);
    header[0] = 0x59;
    header.writeUInt16BE(len, 1);
    return Buffer.concat([header, b]);
  }
  throw new Error('cborBytes: too long for test helper');
};

const cborMap = (entries: [Buffer, Buffer][]): Buffer => {
  const n = entries.length;
  if (n > 23) throw new Error('cborMap: too many entries for test helper');
  const parts: Buffer[] = [Buffer.from([0xa0 + n])];
  for (const [k, v] of entries) parts.push(k, v);
  return Buffer.concat(parts);
};

// ---------------------------------------------------------------------------
// WebAuthn payload builders backed by a real P-256 keypair
// ---------------------------------------------------------------------------

type Authenticator = {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  credentialId: Buffer;
  coseKey: Buffer;
};

const createAuthenticator = (): Authenticator => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const xRaw = Buffer.from(jwk.x, 'base64url');
  const yRaw = Buffer.from(jwk.y, 'base64url');

  // COSE_Key (RFC 8152) for ES256:
  //   1 (kty) = 2 (EC2), 3 (alg) = -7 (ES256), -1 (crv) = 1 (P-256), -2 = x, -3 = y
  const coseKey = cborMap([
    [cborInt(1), cborInt(2)],
    [cborInt(3), cborInt(-7)],
    [cborInt(-1), cborInt(1)],
    [cborInt(-2), cborBytes(xRaw)],
    [cborInt(-3), cborBytes(yRaw)],
  ]);

  return { privateKey, publicKey, credentialId: crypto.randomBytes(32), coseKey };
};

const sha256 = (input: Buffer | string): Buffer => crypto.createHash('sha256').update(input).digest();

// authData layout per WebAuthn:
//   rpIdHash(32) | flags(1) | signCount(4) | [aaguid(16) | credIdLen(2) | credId | coseKey]
const buildAuthData = (params: {
  rpId: string;
  signCount: number;
  flags: number;
  attestedCredentialData?: { aaguid: Buffer; credentialId: Buffer; coseKey: Buffer };
}): Buffer => {
  const rpIdHash = sha256(params.rpId);
  const flags = Buffer.from([params.flags]);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(params.signCount);

  if (!params.attestedCredentialData) return Buffer.concat([rpIdHash, flags, counter]);

  const { aaguid, credentialId, coseKey } = params.attestedCredentialData;
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credentialId.length);
  return Buffer.concat([rpIdHash, flags, counter, aaguid, credIdLen, credentialId, coseKey]);
};

const encodeAttestationObject = (authData: Buffer): Buffer =>
  cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(authData)],
  ]);

// fido2-lib normalises both standard base64 and base64url for challenge comparison.
// Browsers use base64url in clientDataJSON; we mirror that here.
const buildClientDataJSON = (params: { type: 'webauthn.create' | 'webauthn.get'; challenge: string; origin: string }): string => {
  const challengeBase64Url = Buffer.from(params.challenge, 'base64').toString('base64url');
  return JSON.stringify({ type: params.type, challenge: challengeBase64Url, origin: params.origin });
};

const buildAttestationCredential = (params: {
  authenticator: Authenticator;
  rpId: string;
  origin: string;
  challenge: string;
}): PublicKeyCredentialWithAttestation => {
  const authData = buildAuthData({
    rpId: params.rpId,
    signCount: 0,
    flags: 0x41, // AT | UP
    attestedCredentialData: {
      aaguid: Buffer.alloc(16),
      credentialId: params.authenticator.credentialId,
      coseKey: params.authenticator.coseKey,
    },
  });
  const attestationObject = encodeAttestationObject(authData);
  const clientDataJSON = buildClientDataJSON({ type: 'webauthn.create', challenge: params.challenge, origin: params.origin });
  const credentialIdBase64 = params.authenticator.credentialId.toString('base64');
  return {
    id: credentialIdBase64,
    type: 'public-key',
    rawId: credentialIdBase64,
    clientExtensionResults: {},
    response: {
      clientDataJSON: Buffer.from(clientDataJSON, 'utf8').toString('base64'),
      attestationObject: attestationObject.toString('base64'),
    },
  };
};

const buildAssertionCredential = (params: {
  authenticator: Authenticator;
  rpId: string;
  origin: string;
  challenge: string;
  signCount: number;
}): PublicKeyCredentialWithAssertion => {
  const authData = buildAuthData({ rpId: params.rpId, signCount: params.signCount, flags: 0x01 });
  const clientDataJSON = buildClientDataJSON({ type: 'webauthn.get', challenge: params.challenge, origin: params.origin });
  const signature = crypto.sign(
    'sha256',
    Buffer.concat([authData, sha256(clientDataJSON)]),
    params.authenticator.privateKey,
  );
  const credentialIdBase64 = params.authenticator.credentialId.toString('base64');
  return {
    id: credentialIdBase64,
    type: 'public-key',
    rawId: credentialIdBase64,
    clientExtensionResults: {},
    response: {
      clientDataJSON: Buffer.from(clientDataJSON, 'utf8').toString('base64'),
      authenticatorData: authData.toString('base64'),
      signature: signature.toString('base64'),
    },
  };
};

// ---------------------------------------------------------------------------
// Stateful in-memory test doubles
// ---------------------------------------------------------------------------

const makeStatefulCache = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    update: vi.fn(),
    delete: vi.fn(async (key: string) => {
      const had = store.delete(key);
      return had ? 'deleted' : null;
    }),
    _store: store,
  } as unknown as CacheProvider & { _store: Map<string, string> };
};

const makeStatefulRepo = () => {
  const factors = new Map<string, FidoFactor>(); // keyed by factor.id
  let nextId = 1;
  return {
    createFactor: vi.fn(async (actorId: string, publicKey: string, publicKeyId: string, counter: number, active: boolean) => {
      const factor: FidoFactor = { id: `factor-${nextId++}`, actorId, active, publicKey, publicKeyId, counter };
      factors.set(factor.id, factor);
      return factor;
    }),
    listFactors: vi.fn(async (actorId: string, active: boolean) =>
      [...factors.values()].filter(f => f.actorId === actorId && f.active === active),
    ),
    getFactor: vi.fn(async (actorId: string, credentialId: string) =>
      [...factors.values()].find(f => f.actorId === actorId && f.publicKeyId === credentialId),
    ),
    updateFactorCounter: vi.fn(async (actorId: string, factorId: string, counter: number) => {
      const factor = factors.get(factorId);
      if (factor && factor.actorId === actorId) factor.counter = counter;
    }),
    deleteFactor: vi.fn(async (actorId: string, factorId: string) => {
      const factor = factors.get(factorId);
      if (factor && factor.actorId === actorId) factors.delete(factorId);
    }),
    _factors: factors,
  } as unknown as FidoFactorRepository & { _factors: Map<string, FidoFactor> };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const RP_ID = 'example.com';
const RP_ORIGIN = 'https://example.com';

const makeRegisterOptions = (overrides: Partial<RegisterFidoFactorOptions> = {}): RegisterFidoFactorOptions => ({
  rpId: RP_ID,
  rpName: 'Example',
  rpOrigin: RP_ORIGIN,
  userName: 'user@example.com',
  userDisplayName: 'Example User',
  ...overrides,
});

const makeAuthorizeOptions = (overrides: Partial<AuthorizeFidoFactorOptions> = {}): AuthorizeFidoFactorOptions => ({
  rpId: RP_ID,
  rpOrigin: RP_ORIGIN,
  ...overrides,
});

describe('FidoFactorService', () => {
  let cache: ReturnType<typeof makeStatefulCache>;
  let repo: ReturnType<typeof makeStatefulRepo>;
  let service: FidoFactorService;

  beforeEach(() => {
    cache = makeStatefulCache();
    repo = makeStatefulRepo();
    service = new FidoFactorService(new FidoFactorServiceOptions(Duration.fromObject({ minutes: 5 })), repo, cache);
  });

  describe('registerFidoFactor', () => {
    it('returns an attestation with rp/user fields populated from options', async () => {
      const result = await service.registerFidoFactor('actor-1', makeRegisterOptions({ rpIcon: 'https://example.com/icon.png' }));

      expect(result.rp).toEqual({ name: 'Example', id: RP_ID, icon: 'https://example.com/icon.png' });
      expect(result.user.name).toBe('user@example.com');
      expect(result.user.displayName).toBe('Example User');
      expect(result.attestation).toBe('none');
    });

    it('encodes user.id as the actor id and emits a 128-byte challenge', async () => {
      const result = await service.registerFidoFactor('actor-42', makeRegisterOptions());

      expect(Buffer.from(result.user.id, 'base64').toString('utf8')).toBe('actor-42');
      expect(Buffer.from(result.challenge, 'base64')).toHaveLength(128);
    });

    it('produces a different challenge on every call', async () => {
      const a = await service.registerFidoFactor('actor-1', makeRegisterOptions());
      const b = await service.registerFidoFactor('actor-1', makeRegisterOptions());
      expect(a.challenge).not.toBe(b.challenge);
    });

    it('caches the attestation expectations under a per-actor key', async () => {
      await service.registerFidoFactor('actor-1', makeRegisterOptions());

      const cached = cache._store.get('fido_factor_registration_actor-1');
      expect(cached).toBeDefined();
      const payload = JSON.parse(cached!);
      expect(payload).toMatchObject({ rpId: RP_ID, origin: RP_ORIGIN, factor: 'either' });
      expect(typeof payload.challenge).toBe('string');
    });
  });

  describe('createFidoFactorFromRegistration', () => {
    it('throws 401 with invalid_registration when no pending registration is cached', async () => {
      const authenticator = createAuthenticator();
      const credential = buildAttestationCredential({ authenticator, rpId: RP_ID, origin: RP_ORIGIN, challenge: Buffer.alloc(128).toString('base64') });

      await expect(service.createFidoFactorFromRegistration('actor-1', credential)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_registration"' },
      });
    });

    it('throws 401 with invalid_credentials when the attestation challenge does not match', async () => {
      await service.registerFidoFactor('actor-1', makeRegisterOptions());

      const authenticator = createAuthenticator();
      const wrongChallenge = crypto.randomBytes(128).toString('base64');
      const credential = buildAttestationCredential({ authenticator, rpId: RP_ID, origin: RP_ORIGIN, challenge: wrongChallenge });

      await expect(service.createFidoFactorFromRegistration('actor-1', credential)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_credentials"' },
      });
    });

    it('throws 401 with invalid_credentials when the rpId does not match', async () => {
      const attestation = await service.registerFidoFactor('actor-1', makeRegisterOptions());

      const authenticator = createAuthenticator();
      const credential = buildAttestationCredential({
        authenticator,
        rpId: 'different.com', // wrong rpIdHash in authData
        origin: RP_ORIGIN,
        challenge: attestation.challenge,
      });

      await expect(service.createFidoFactorFromRegistration('actor-1', credential)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_credentials"' },
      });
    });

    it('persists the verified credential and returns the new factor id', async () => {
      const attestation = await service.registerFidoFactor('actor-1', makeRegisterOptions());

      const authenticator = createAuthenticator();
      const credential = buildAttestationCredential({ authenticator, rpId: RP_ID, origin: RP_ORIGIN, challenge: attestation.challenge });

      const factorId = await service.createFidoFactorFromRegistration('actor-1', credential);

      expect(factorId).toBe('factor-1');
      const stored = repo._factors.get('factor-1')!;
      expect(stored.actorId).toBe('actor-1');
      expect(stored.active).toBe(true);
      expect(stored.publicKeyId).toBe(authenticator.credentialId.toString('base64'));
      expect(stored.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(stored.counter).toBe(0);
    });
  });

  describe('createFidoAuthorizationChallenge', () => {
    it('throws 404 when the actor has no active factors', async () => {
      await expect(service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions())).rejects.toMatchObject({
        statusCode: 404,
        details: { actorId: 'no factors found' },
      });
    });

    it('returns assertionOptions with allowCredentials populated from the actor’s active factors', async () => {
      // Register a factor end-to-end so the repo and cache are in a real state.
      const attestation = await service.registerFidoFactor('actor-1', makeRegisterOptions());
      const authenticator = createAuthenticator();
      await service.createFidoFactorFromRegistration(
        'actor-1',
        buildAttestationCredential({ authenticator, rpId: RP_ID, origin: RP_ORIGIN, challenge: attestation.challenge }),
      );

      const result = await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());

      expect(result.allowCredentials).toEqual([{ id: authenticator.credentialId.toString('base64'), type: 'public-key' }]);
      expect(Buffer.from(result.challenge, 'base64')).toHaveLength(128);
    });

    it('caches assertion expectations including the userHandle for the actor', async () => {
      // Seed a factor directly so we can isolate this method's cache write.
      await repo.createFactor('actor-1', 'pem', 'cred-1', 0, true);

      await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());

      const cached = cache._store.get('fido_factor_authorization_actor-1');
      expect(cached).toBeDefined();
      const payload = JSON.parse(cached!);
      expect(payload).toMatchObject({
        rpId: RP_ID,
        origin: RP_ORIGIN,
        factor: 'either',
        userHandle: Buffer.from('actor-1').toString('base64'),
      });
      expect(payload.allowCredentials).toEqual([{ id: 'cred-1', type: 'public-key' }]);
    });
  });

  describe('verifyFidoAuthorizationChallenge', () => {
    // Registers a factor with a real keypair and returns the bits needed to assert.
    const seedFactor = async (actorId: string) => {
      const attestation = await service.registerFidoFactor(actorId, makeRegisterOptions());
      const authenticator = createAuthenticator();
      const factorId = await service.createFidoFactorFromRegistration(
        actorId,
        buildAttestationCredential({ authenticator, rpId: RP_ID, origin: RP_ORIGIN, challenge: attestation.challenge }),
      );
      return { authenticator, factorId };
    };

    it('throws 401 with invalid_credentials when no challenge is cached', async () => {
      const { authenticator } = await seedFactor('actor-1');

      const credential = buildAssertionCredential({
        authenticator,
        rpId: RP_ID,
        origin: RP_ORIGIN,
        challenge: Buffer.alloc(128).toString('base64'),
        signCount: 1,
      });

      await expect(service.verifyFidoAuthorizationChallenge('actor-1', credential)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_credentials"' },
      });
    });

    it('throws 401 with invalid_credentials when the credential id is unknown for this actor', async () => {
      await seedFactor('actor-1');
      const challenge = await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());

      // Sign a perfectly valid assertion, but with a credential id no factor matches.
      const stranger = createAuthenticator();
      const credential = buildAssertionCredential({
        authenticator: stranger,
        rpId: RP_ID,
        origin: RP_ORIGIN,
        challenge: challenge.challenge,
        signCount: 1,
      });

      await expect(service.verifyFidoAuthorizationChallenge('actor-1', credential)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_credentials"' },
      });
    });

    it('throws 401 with invalid_credentials when the signature is invalid (wrong key)', async () => {
      const { authenticator } = await seedFactor('actor-1');
      const challenge = await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());

      // Attacker re-uses the legitimate credential id but signs with a key they own.
      const attacker = createAuthenticator();
      const forged = buildAssertionCredential({
        authenticator: { ...attacker, credentialId: authenticator.credentialId },
        rpId: RP_ID,
        origin: RP_ORIGIN,
        challenge: challenge.challenge,
        signCount: 1,
      });

      await expect(service.verifyFidoAuthorizationChallenge('actor-1', forged)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_credentials"' },
      });
    });

    it('throws 401 with invalid_credentials when the assertion challenge does not match the cached one', async () => {
      const { authenticator } = await seedFactor('actor-1');
      await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());

      const credential = buildAssertionCredential({
        authenticator,
        rpId: RP_ID,
        origin: RP_ORIGIN,
        challenge: crypto.randomBytes(128).toString('base64'), // not the cached challenge
        signCount: 1,
      });

      await expect(service.verifyFidoAuthorizationChallenge('actor-1', credential)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_credentials"' },
      });
    });

    it('verifies a valid assertion, persists the new counter, and returns actorId/factorId', async () => {
      const { authenticator, factorId } = await seedFactor('actor-1');
      const challenge = await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());

      const credential = buildAssertionCredential({
        authenticator,
        rpId: RP_ID,
        origin: RP_ORIGIN,
        challenge: challenge.challenge,
        signCount: 7,
      });

      const result = await service.verifyFidoAuthorizationChallenge('actor-1', credential);

      expect(result).toEqual({ actorId: 'actor-1', factorId });
      expect(repo._factors.get(factorId)!.counter).toBe(7);
    });

    it('rejects an assertion whose signCount is not strictly greater than the stored counter', async () => {
      const { authenticator, factorId } = await seedFactor('actor-1');

      // First successful assertion bumps the counter to 5.
      let challenge = await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());
      await service.verifyFidoAuthorizationChallenge(
        'actor-1',
        buildAssertionCredential({ authenticator, rpId: RP_ID, origin: RP_ORIGIN, challenge: challenge.challenge, signCount: 5 }),
      );
      expect(repo._factors.get(factorId)!.counter).toBe(5);

      // A replay with the same counter must be rejected (cloned-authenticator signal).
      challenge = await service.createFidoAuthorizationChallenge('actor-1', makeAuthorizeOptions());
      const replay = buildAssertionCredential({
        authenticator,
        rpId: RP_ID,
        origin: RP_ORIGIN,
        challenge: challenge.challenge,
        signCount: 5,
      });
      await expect(service.verifyFidoAuthorizationChallenge('actor-1', replay)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_credentials"' },
      });
    });
  });
});
