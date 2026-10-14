---
'@maroonedsoftware/servercore': minor
---

Add `signRequestBody`, the outbound counterpart of `DefaultSignaturePolicy`, and optional replay protection for signed requests. `SignatureOptions` gains `prefix` (a literal such as `v1=` ahead of the encoded HMAC) and `timestamp: { header, maxAgeSeconds }`. With a timestamp, the HMAC covers `"<unix seconds>.<raw body>"` and the policy denies a missing (`missing_timestamp`), non-integer (`invalid_timestamp`), or out-of-window (`timestamp_out_of_window`, past or future) timestamp before checking the signature, reading "now" from the policy envelope. Configs without either field verify exactly as before.
