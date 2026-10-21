---
'@maroonedsoftware/saml': minor
---

**Breaking:** `SamlFactorService.completeAuthorization` now requires `expectedRequestId`, the `requestId` that `beginAuthorization` returned to this browser. Keep it in a cookie (`SameSite=None; Secure`, since the ACS post is cross-site) or the session. A response answering any other request is refused with a 400 (`details.InResponseTo: 'not the expected request'`, audit reason `unsolicited`) before that request is consumed, which stops login CSRF and linking a victim's identity to an attacker's account. When the browser has no stored id, refuse the post or restart the flow.
