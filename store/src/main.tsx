import React from "react";
import ReactDOM from "react-dom/client";
import { FrappeProvider } from "frappe-react-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "@/styles/globals.css";

declare global {
  interface Window {
    csrf_token: string;
    frappe_boot: {
      frappe_version: string;
      site_name: string;
      read_only_mode: boolean;
      system_timezone: string;
    };
  }
}

const getCSRFToken = (): string => {
  if (window.csrf_token && !window.csrf_token.includes("{{")) {
    return window.csrf_token;
  }
  return "";
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <FrappeProvider
        tokenParams={{
          type: "token",
          useToken: true,
          token: () => getCSRFToken(),
        }}
        socketPort={import.meta.env.DEV ? "9004" : undefined}
        enableSocket={false}
      >
        <App />
      </FrappeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
