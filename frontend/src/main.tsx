import React from "react";
import ReactDOM from "react-dom/client";
import { FrappeProvider } from "frappe-react-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import GuestApp from "./GuestApp";
import "@/styles/globals.css";

// Declare window.csrf_token type
declare global {
  interface Window {
    csrf_token: string;
    frappe_boot: {
      frappe_version: string;
      site_name: string;
      read_only_mode: boolean;
      system_timezone: string;
    };
    guest_context?: {
      site_name: string;
    };
  }
}

// Get CSRF token from window (injected by Frappe template via pos.py)
const getCSRFToken = (): string => {
  // In production, Frappe injects the token via Jinja template
  if (window.csrf_token && !window.csrf_token.includes("{{")) {
    return window.csrf_token;
  }
  // In dev mode with Vite, we don't have the token pre-injected
  // frappe-react-sdk will handle fetching it
  return "";
};

// Detect if this is the guest call-waiter page (no auth needed)
const isGuestPage = window.location.pathname.startsWith("/call-waiter");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isGuestPage ? (
        // Guest page — no FrappeProvider needed (uses direct fetch calls)
        <GuestApp />
      ) : (
        // Main POS app — full FrappeProvider with auth
        <FrappeProvider
          tokenParams={{
            type: "token",
            useToken: true,
            token: () => getCSRFToken(),
          }}
          socketPort={import.meta.env.DEV ? "9004" : undefined}
          enableSocket={true}
        >
          <App />
        </FrappeProvider>
      )}
    </QueryClientProvider>
  </React.StrictMode>
);
