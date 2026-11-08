# Effect

This is Effect v4, whose APIs differ from v3. Check the source in `node_modules/effect` rather than relying on memory.

- Decode external input with Schema at the boundary and treat it as untrusted until decoded. Inside, trust the decoded types.
- Model failures as typed errors in the error channel instead of throwing.
- Provide dependencies as services and Layers.

For tests, see [TESTING.md](TESTING.md).
