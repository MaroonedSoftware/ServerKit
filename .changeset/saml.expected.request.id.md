---
'@maroonedsoftware/saml': minor
---

`SamlFactorService.completeAuthorization` takes an optional `expectedRequestId`: the `requestId` that `beginAuthorization` returned to this browser. A response answering any other request is refused with a 400 (`details.InResponseTo: 'not the expected request'`, audit reason `unsolicited`) before that request is consumed. Pass it to stop login CSRF and linking a victim's identity to an attacker's account. Omitting it keeps the previous behavior.
