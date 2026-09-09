import { useState, useEffect } from "react";

interface GuestSessionData {
  token: string;
  restaurantName: string;
  loading: boolean;
  error: string;
}

async function guestApi(method: string, args: Record<string, string>) {
  const csrfToken =
    window.csrf_token && !window.csrf_token.includes("{{")
      ? window.csrf_token
      : "";

  const res = await fetch(`/api/method/servepos.api.guest.${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(args),
  });

  const data = await res.json();
  if (data.exc) {
    const msg = data._server_messages
      ? JSON.parse(JSON.parse(data._server_messages)[0]).message
      : data.exc;
    throw new Error(msg);
  }
  return data.message;
}

/**
 * Shared hook for guest pages to get session token and restaurant info.
 * Reuses existing token from sessionStorage if available.
 */
export function useGuestSession(seatCode: string): GuestSessionData {
  const [token, setToken] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!seatCode) {
      setError("No seat code found.");
      setLoading(false);
      return;
    }

    // Check sessionStorage first
    const savedToken = sessionStorage.getItem(`servepos_token_${seatCode}`);
    const savedRestaurant = sessionStorage.getItem(`servepos_restaurant_${seatCode}`);

    if (savedToken) {
      setToken(savedToken);
      setRestaurantName(savedRestaurant || "");
      setLoading(false);
      return;
    }

    async function init() {
      try {
        const result = await guestApi("get_guest_session", {
          seat_code: seatCode,
        });
        setToken(result.token);
        sessionStorage.setItem(`servepos_token_${seatCode}`, result.token);

        const name = result.restaurants?.[0]?.venue_name || "";
        setRestaurantName(name);
        sessionStorage.setItem(`servepos_restaurant_${seatCode}`, name);
      } catch (e: any) {
        setError(e.message || "Failed to load. Please scan the QR code again.");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [seatCode]);

  return { token, restaurantName, loading, error };
}
