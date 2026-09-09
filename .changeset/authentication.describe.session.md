---
'@maroonedsoftware/authentication': minor
---

Add `describeSession`, a display projection for a "your active sessions" list. It flattens the
`SessionDevice` block and converts every Luxon `DateTime` to ISO 8601, which is what a wire contract
wants and what both ServerKit consumers were each writing by hand in identical mappers.

Two fields a list also wants are deliberately absent, because neither is the package's to know:
whether a row is the caller's own session, which needs the token the request arrived with, and any
application-specific claim such as an organisation.

Unlike the audit payload, the projection carries no claims, so an application cannot leak one into a
user-facing list by accident.
