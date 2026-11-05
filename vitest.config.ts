import { defineConfig } from "vitest/config";
// Only the standalone parts run here. app/ is the desktop app's generation module: it needs the
// pre-existing LecNote app (Tauri) to build and is included as source, not run.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
