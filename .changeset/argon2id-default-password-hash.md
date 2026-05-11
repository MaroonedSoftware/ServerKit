---
'@maroonedsoftware/authentication': minor
---

Replace `Pbkdf2PasswordHashProvider` with `Argon2idPasswordHashProvider` as the bundled `PasswordHashProvider` implementation.

- New: `Argon2idPasswordHashProvider` and `ARGON2ID_DEFAULTS`. Produces a self-describing PHC string (`$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`) in the `hash` column and leaves `salt` empty. OWASP Password Storage Cheat Sheet (2024) profile: `m=19456 KiB, t=2, p=1, outputLen=32`.
- Removed: `Pbkdf2PasswordHashProvider`. There is no in-package migration path — consumers with existing PBKDF2-hashed passwords must continue to ship their own PBKDF2 provider (subclass `PasswordHashProvider`) or run a coordinated reset.
- DI binding: bind `Argon2idPasswordHashProvider` as the `PasswordHashProvider`.
- New runtime dependency: `@node-rs/argon2` (NAPI-RS prebuilt binaries, no `node-gyp`). If your install uses pnpm's `onlyBuiltDependencies` allowlist, add `@node-rs/argon2` to it.
- Schema unchanged. Argon2id rows store the PHC string in `hash` and `''` in `salt`; ad-hoc SQL that assumes `salt != ''` for password rows will need updating.
