---
'@maroonedsoftware/zod': minor
---

fix: use issue message for invalid_union with no branch errors

- Updated the error handling in the processIssue function to utilize the specific issue message when an invalid_union has no associated branch errors.
- Added a test case to ensure that the correct message is returned in this scenario.
