import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspacePackage = (name: string) => (pkg: string) =>
  fileURLToPath(new URL(`./tests/${name}/node_modules/${pkg}`, import.meta.url));

const aliasTo = (dir: (pkg: string) => string, pkg: string) => {
  const escaped = pkg.replace(/[/]/g, "\\/");
  return [
    { find: new RegExp(`^${escaped}$`), replacement: dir(pkg) },
    { find: new RegExp(`^${escaped}\\/(.*)$`), replacement: `${dir(pkg)}/$1` },
  ];
};

const reactFrom = (version: string) => {
  const dir = workspacePackage(`react${version}`);
  return [...aliasTo(dir, "react"), ...aliasTo(dir, "react-dom"), ...aliasTo(dir, "@testing-library/react")];
};

// Without a wax major the root's @hiveio/wax resolves: the dev-catalog 1.28 release candidate.
const DEV_WAX_MAJOR = "1";
const waxFrom = (major?: string) => (major ? aliasTo(workspacePackage(`wax${major}`), "@hiveio/wax") : []);

const project = (version: string, waxMajor?: string) => ({
  extends: true as const,
  test: {
    name: waxMajor ? `react${version}-wax${waxMajor}` : `react${version}`,
    provide: { reactMajor: version, waxMajor: waxMajor ?? DEV_WAX_MAJOR },
  },
  resolve: { alias: [...reactFrom(version), ...waxFrom(waxMajor)] },
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
    projects: [project("18"), project("19"), project("18", "2"), project("19", "2")],
  },
});
