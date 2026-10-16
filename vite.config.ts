import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: o service worker baixa a nova versão e assume sozinho.
      // Com "prompt" ele só ativava quando alguém chamasse updateSW() — e
      // ninguém chama (não há registro do virtual module). Resultado: o tablet
      // instalado continuava executando um bundle antigo para sempre, e correções
      // publicadas nunca chegavam ao dispositivo.
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
      workbox: {
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024, // 32 MB (ONNX WASM is ~28 MB)
        // version.json must always come from the server. Precaching it can make
        // an old service worker hide a newly published release indefinitely.
        globIgnores: ["**/version.json"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === "/version.json",
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "Anatriello Gestão",
        short_name: "Anatriello",
        description: "Plataforma corporativa Anatriello — gestão, RH e colaboradores.",
        theme_color: "#f59e0b",
        background_color: "#faf4e8",
        display: "standalone",
        icons: [
          { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
