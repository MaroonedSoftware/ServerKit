---
'@maroonedsoftware/scim': patch
---

Honour `?count=0` on the SCIM list endpoints. RFC 7644 §3.4.2.4 gives a count below 1 its own
meaning, return no resources but still report `totalResults`, and it is the probe Okta and Entra
make when setting up a connection. The query-string parser treated any value below 1 as unset and
returned a full page, disagreeing with the `.search` body path, which already handled it correctly.
