import { globSync } from "node:fs";
import { defineConfig } from "vitest/config";

const projects = ["packages/*", "apps/*"];

export default defineConfig({
  test: {
    // Vitest throws when no project matches, and the workspaces do not exist yet.
    ...(globSync(projects).length > 0 ? { projects } : {}),
    passWithNoTests: true,
  },
});
