---
'@maroonedsoftware/authentication': patch
---

Compare magic-link tokens in constant time. `EmailFactorService` verified magic-link tokens with a
plain `!==` while every other secret comparison in the package used `crypto.timingSafeEqual`.

Adds a shared `timingSafeCompare` helper and routes both the email factor and the support
verification service through it. The helper compares byte lengths rather than character counts, so
a submitted value that is the right number of characters but a different number of bytes returns
`false` instead of throwing a `RangeError`.
