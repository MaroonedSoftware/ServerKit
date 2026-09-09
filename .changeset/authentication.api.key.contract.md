---
'@maroonedsoftware/authentication': minor
---

Add the API key seam: `ApiKey` and its supporting types, the `ApiKeyRepository` contract, and the
token codec (`formatApiKeyToken`, `parseApiKeyToken`, `hashApiKeyToken`, `apiKeyHint`).

Tokens are GitHub-style, `{prefix}_{type}_{body}{checksum}`, where the body is 32 random bytes in
base62 and the checksum is a CRC32 over everything before it. The checksum means a truncated or
mistyped credential is rejected without a storage read, which matters because every bearer request
reaches the API key handler when it sits in a `ChainedAuthenticationHandler`, and it lets secret
scanners recognise a leaked key.

Lookup is by SHA-256 of the whole token, so validation is one indexed read rather than a scan over
every active hash. That is also why the hash is not Argon2id: a 32-byte random token cannot be
guessed, so a memory-hard KDF on the hot path would buy nothing and cost a denial-of-service
vector.

`AuthenticationFactorMethod` gains `'apikey'` so a key-authenticated session records honestly how it
was established, and so `excludeMethods: ['apikey']` on a step-up policy means something.
