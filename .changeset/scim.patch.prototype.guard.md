---
'@maroonedsoftware/scim': patch
---

Guard prototype keys in the SCIM PATCH merge. `applyScimPatch` assigned attacker-controlled keys
from the request body with plain property assignment, so a pathless `add` carrying `__proto__`
invoked the inherited setter and reparented the patched object instead of storing an attribute.
Merged keys are now defined as own data properties.
