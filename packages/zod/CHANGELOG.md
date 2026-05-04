# @maroonedsoftware/zod

## 0.4.1

### Patch Changes

- db220a1: chore: bump kysely, zod patch versions
- 9e2c2de: chore: update package versions for dependencies and devDependencies
  - @maroonedsoftware/errors@1.6.0

## 0.4.0

### Minor Changes

- c48adc0: fix: use issue message for invalid_union with no branch errors
  - Updated the error handling in the processIssue function to utilize the specific issue message when an invalid_union has no associated branch errors.
  - Added a test case to ensure that the correct message is returned in this scenario.

## 0.3.1

### Patch Changes

- Updated dependencies [7624166]
  - @maroonedsoftware/errors@1.6.0

## 0.3.0

### Minor Changes

- 0ef3fb0: feat: enhance error formatting in Zod validation
  - Introduced detailed error descriptions for various validation issues, including type mismatches, size constraints, and custom messages.
  - Refactored error processing logic to improve clarity and maintainability.
  - Added comprehensive unit tests to ensure accurate error formatting and handling for different validation scenarios.

## 0.2.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/errors@1.5.0

## 0.2.0

### Minor Changes

- b1005f4: adding jsdocs and updating readme

## 0.1.0

### Minor Changes

- b9940cc: initial release
