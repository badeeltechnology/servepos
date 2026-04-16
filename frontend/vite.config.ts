import path from "path";
import fs from "fs";
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";

const POS_HTML = path.resolve(__dirname, "../servepos/www/pos.html");

/**
 * After Vite finishes writing hashed asset files, rewrite the <script>/<link>
 * tags in servepos/www/pos.html (the Frappe-rendered template) to point at the
 * new hashed filenames so the browser always fetches a fresh bundle.
 */
function updatePosHtmlPlugin(): Plugin {
  return {
    name: "servepos-update-pos-html",
    apply: "build",
    closeBundle() {
      const distDir = path.resolve(__dirname, "../servepos/public/frontend/assets");
      const files = fs.readdirSync(distDir);
      const jsFile = files.find((f) => /^index-.*\.js$/.test(f));
      const cssFile = files.find((f) => /^index-.*\.css$/.test(f));
      if (!jsFile || !cssFile) {
        throw new Error(`Could not find hashed index.js/index.css in ${distDir}`);
      }

      let html = fs.readFileSync(POS_HTML, "utf-8");
      html = html.replace(
        /src="\/assets\/servepos\/frontend\/assets\/index(?:-[A-Za-z0-9_-]+)?\.js"/,
        `src="/assets/servepos/frontend/assets/${jsFile}"`
      );
      html = html.replace(
        /href="\/assets\/servepos\/frontend\/assets\/index(?:-[A-Za-z0-9_-]+)?\.css"/,
        `href="/assets/servepos/frontend/assets/${cssFile}"`
      );
      fs.writeFileSync(POS_HTML, html);
      console.log(`[servepos] pos.html updated → ${jsFile}, ${cssFile}`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), updatePosHtmlPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../servepos/public/frontend",
    emptyOutDir: true,
    target: "es2015",
    rollupOptions: {
      output: {
        entryFileNames: "assets/index-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (info) => {
          // Hash only the main CSS; keep other assets (images/fonts) un-hashed for stable URLs
          if (info.name && info.name.endsWith(".css")) {
            return "assets/index-[hash][extname]";
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
