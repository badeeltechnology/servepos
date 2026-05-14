import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../servepos/public/frontend",
    emptyOutDir: true,
    target: "es2015",
    manifest: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/main.tsx"),
      output: {
        entryFileNames: "assets/index.[hash].js",
        chunkFileNames: "assets/[name].[hash].js",
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith(".css")) {
            return "assets/index.[hash][extname]";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
