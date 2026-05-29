---
'@maroonedsoftware/authentication': minor
---

`OidcFactorRepository.updatePicture` is now a required method. It was previously optional (`updatePicture?`), so repositories could opt out by omitting it. Implementations that do not define `updatePicture` will no longer type-check — add the method (and a backing `picture` column) to your `OidcFactorRepository` implementation.
