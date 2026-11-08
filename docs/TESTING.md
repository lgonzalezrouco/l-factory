# Testing

Tests run with vitest. Write Effect tests with `it.effect` from `@effect/vitest`.

- Before writing a test, name the realistic code edit that would make it fail. If you can't, don't write it. Coverage is not a reason.
- Prefer no new test over a bad test.
- A bug fix comes with a test that fails on the old code.
- Assert behavior a caller can observe, not implementation details.
- Write one test per equivalence class. Two inputs belong to the same class when no realistic edit breaks one without the other.
- Hardcode expected values from the requirement. Never compute them with the code under test.
