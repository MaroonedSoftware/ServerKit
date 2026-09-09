---
'@maroonedsoftware/authentication': minor
---

Add `SessionDevice` to `AuthenticationSession`: an optional `device` block recording the IP address,
user agent, and a label for the request that established the session.

A session recorded who and when but nothing about where from, so `getSessionsForSubject` returned a
list a user could not tell apart. Both ServerKit consumers worked around it by stamping `loginIp` and
`loginUserAgent` into session claims and digging them back out later.

`normaliseSessionDevice` trims each field, drops blanks, and clamps the user agent to
`MAX_USER_AGENT_LENGTH` (512, matching what both consumers already clamp to). Blank handling is the
part that matters: both HTTP adapters set `userAgent` to an empty string when the header is absent,
so without it every session would record an empty user agent rather than none.

The IP is not validated. A correct IPv4/IPv6 validator is more surface than this earns, and the
adapters already defer to the framework's own proxy handling. An application writing the value to a
typed column — Postgres `inet` rejects malformed input — owns that check.

The block is optional throughout, so sessions already in a live cache deserialise without it rather
than failing. Nothing populates it yet; the write paths accept it in a following change.
