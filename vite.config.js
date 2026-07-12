import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";


const projectRoot =
    fileURLToPath(new URL(".", import.meta.url));


export default defineConfig({
    base: "/coursepilot/",

    build: {
        rollupOptions: {
            input: {
                booking: fileURLToPath(
                    new URL("index.html", import.meta.url)
                ),
                dashboard: fileURLToPath(
                    new URL("dashboard.html", import.meta.url)
                )
            }
        }
    },

    root: projectRoot
});
