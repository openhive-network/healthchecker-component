import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const reactFrom = (version: string) => {
  const dir = (pkg: string) => fileURLToPath(new URL(`./tests/react${version}/node_modules/${pkg}`, import.meta.url));
  return [
    { find: /^react$/, replacement: dir("react") },
    { find: /^react\/(.*)$/, replacement: `${dir("react")}/$1` },
    { find: /^react-dom$/, replacement: dir("react-dom") },
    { find: /^react-dom\/(.*)$/, replacement: `${dir("react-dom")}/$1` },
    { find: /^@testing-library\/react$/, replacement: dir("@testing-library/react") },
  ];
};

const project = (version: string) => ({
  extends: true as const,
  test: { name: `react${version}`, provide: { reactMajor: version } },
  resolve: { alias: reactFrom(version) },
});

export default defineConfig({
  // lucide-react has no `exports`; its `main` is CommonJS, whose require("react") Node resolves.
  resolve: { mainFields: ["module", "main"] },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // Node resolves `react` from an external dependency's own location, past the alias, so
    // the bundled UI dependencies that import React go through Vite. The packages installed
    // with each React (react-dom, @testing-library/react) already resolve their own.
    server: {
      deps: {
        inline: [/@radix-ui\//, /lucide-react/, /react-remove-scroll/, /react-style-singleton/, /use-callback-ref/, /use-sidecar/],
      },
    },
    projects: [project("18"), project("19")],
  },
});
