import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vite's SSR resolver doesn't always recognise newer Node builtins like
    // `node:sqlite`. Forcing anything under the `node:` scheme to be
    // externalised makes it hand off to Node's own loader.
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
});
