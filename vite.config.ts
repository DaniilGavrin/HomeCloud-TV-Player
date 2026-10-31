
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";

const host = "0.0.0.0";

export default defineConfig(() => ({
    plugins: [react()],

    clearScreen: false,

    server: {
        port: 1420,
        strictPort: true,
        host: host || false,

        hmr: host
            ? {
                protocol: "ws",
                host,
                port: 1421,
            }
            : undefined,

        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
}));
