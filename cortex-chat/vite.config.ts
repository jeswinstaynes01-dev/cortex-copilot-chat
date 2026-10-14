import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/* The Spring Boot backend lives in ../copilot-dashboard and listens on 8080.
   Proxying /api through the dev server keeps the browser on one origin, which
   matters more than it looks: EventSource cannot send credentials or custom
   headers cross-origin without CORS work on the server, and a same-origin
   proxy sidesteps all of it.

   5174 because 5173 is taken by the copilot-dashboard frontend. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        /* `changeOrigin` only rewrites the Host header. The browser still
           attaches `Origin: http://localhost:5174` to every POST, and the
           backend's CORS allowlist contains only the dashboard's own
           `http://localhost:5173` — so Spring rejected every write with a
           bare 403 while GETs (which carry no Origin when same-origin) sailed
           through.

           Deleting the header is the right fix rather than widening the
           server's allowlist: once a request has been forwarded by a proxy,
           the browser's Origin is stale information. The backend is talking
           to the dev server, not to the page, and a request with no Origin is
           treated as same-origin — which it now genuinely is. */
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
        },
      },
    },
  },
});
