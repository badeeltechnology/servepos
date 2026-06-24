import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { ImageGallery } from "@/components/ImageGallery";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";

// Types
interface MenuImage {
  image: string;
  caption: string;
  display_order: number;
}

interface Restaurant {
  pos_profile: string;
  display_name: string;
  description: string;
  logo: string;
  venue_name: string;
  venue_logo: string;
  menu_images: MenuImage[];
}

interface SeatInfo {
  name: string;
  table_name: string;
  room: string;
}

interface ActiveCall {
  call_name: string;
  pos_profile: string;
  restaurant_name: string;
  status: string;
  waiter_name?: string;
}

// API helper — works for guest (no auth required)
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
    const msg =
      data._server_messages
        ? JSON.parse(JSON.parse(data._server_messages)[0]).message
        : data.exc;
    throw new Error(msg);
  }
  return data.message;
}

export default function CallWaiter() {
  const { seatCode } = useParams<{ seatCode: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [seat, setSeat] = useState<SeatInfo | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callingProfile, setCallingProfile] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Venue branding (from first restaurant)
  const venueName = restaurants[0]?.venue_name || "";
  const venueLogo = restaurants[0]?.venue_logo || "";

  // Initialize session
  useEffect(() => {
    if (!seatCode) {
      setError("No seat code found. Please scan the QR code again.");
      setLoading(false);
      return;
    }

    // Check for existing token in sessionStorage
    const savedToken = sessionStorage.getItem(`servepos_token_${seatCode}`);

    async function init() {
      try {
        const result = await guestApi("get_guest_session", {
          seat_code: seatCode!,
        });
        const newToken = result.token;
        setToken(newToken);
        setSeat(result.seat);
        setRestaurants(result.restaurants || []);
        sessionStorage.setItem(`servepos_token_${seatCode}`, newToken);
      } catch (e: any) {
        setError(e.message || "Failed to load. Please scan the QR code again.");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [seatCode]);

  // Poll active call status
  useEffect(() => {
    if (!activeCall) return;

    const interval = setInterval(async () => {
      try {
        const result = await guestApi("get_call_status", {
          call_name: activeCall.call_name,
          token,
        });
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                status: result.status,
                waiter_name: result.waiter_name,
              }
            : null
        );
        // Clear if terminal state
        if (["Attended", "Expired", "Cancelled"].includes(result.status)) {
          setTimeout(() => setActiveCall(null), 5000);
        }
      } catch {
        // Silently ignore poll errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeCall, token]);

  const handleCallWaiter = useCallback(
    async (restaurant: Restaurant) => {
      if (!seatCode || !token) return;

      setCallingProfile(restaurant.pos_profile);
      try {
        const result = await guestApi("create_waiter_call", {
          seat_code: seatCode,
          pos_profile: restaurant.pos_profile,
          token,
        });
        setActiveCall({
          call_name: result.call_name,
          pos_profile: restaurant.pos_profile,
          restaurant_name: restaurant.display_name,
          status: "Pending",
        });
      } catch (e: any) {
        alert(e.message || "Failed to call waiter. Please try again.");
      } finally {
        setCallingProfile("");
      }
    },
    [seatCode, token]
  );

  const handleCancel = useCallback(async () => {
    if (!activeCall || !token) return;

    setCancelling(true);
    try {
      await guestApi("cancel_waiter_call", {
        call_name: activeCall.call_name,
        token,
      });
      setActiveCall(null);
    } catch (e: any) {
      alert(e.message || "Failed to cancel.");
    } finally {
      setCancelling(false);
    }
  }, [activeCall, token]);

  // --- Render ---

  if (loading) {
    return (
      <GuestShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-500">Loading...</p>
        </div>
      </GuestShell>
    );
  }

  if (error) {
    return (
      <GuestShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
          <div className="text-6xl mb-4">📱</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Scan Required
          </h2>
          <p className="text-gray-500 text-center max-w-sm">{error}</p>
        </div>
      </GuestShell>
    );
  }

  return (
    <GuestShell>
      {/* Venue Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {venueLogo ? (
            <img
              src={venueLogo}
              alt={venueName}
              className="w-10 h-10 rounded-lg object-contain"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <span className="text-white text-lg font-bold">
                {(venueName || "S")[0]}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">
              {venueName || "Welcome"}
            </h1>
            {seat && (
              <p className="text-sm text-gray-500">
                {seat.room ? `${seat.room} — ` : ""}
                {seat.table_name}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Active Call Status */}
      {activeCall && (
        <div className="max-w-lg mx-auto px-4 mt-4">
          <CallStatusCard
            activeCall={activeCall}
            onCancel={handleCancel}
            cancelling={cancelling}
          />
        </div>
      )}

      {/* Restaurant List */}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4 pb-8">
        {restaurants.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">🍽️</div>
            <p className="text-gray-500">
              No restaurants available at the moment.
            </p>
          </div>
        ) : (
          restaurants.map((restaurant) => (
            <RestaurantCard
              key={restaurant.pos_profile}
              restaurant={restaurant}
              onCallWaiter={() => handleCallWaiter(restaurant)}
              isCalling={callingProfile === restaurant.pos_profile}
              hasActiveCall={
                activeCall?.pos_profile === restaurant.pos_profile
              }
              disabled={!!activeCall}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-4 text-xs text-gray-400">
        Powered by ServePOS
      </div>
    </GuestShell>
  );
}

// --- Sub-Components ---

function GuestShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {children}
    </div>
  );
}

function RestaurantCard({
  restaurant,
  onCallWaiter,
  isCalling,
  hasActiveCall,
  disabled,
}: {
  restaurant: Restaurant;
  onCallWaiter: () => void;
  isCalling: boolean;
  hasActiveCall: boolean;
  disabled: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Restaurant Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        {restaurant.logo ? (
          <img
            src={restaurant.logo}
            alt={restaurant.display_name}
            className="w-12 h-12 rounded-xl object-contain"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xl font-bold">
              {restaurant.display_name[0]}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900 truncate">
            {restaurant.display_name}
          </h2>
          {restaurant.description && (
            <p className="text-sm text-gray-500 line-clamp-2">
              {restaurant.description}
            </p>
          )}
        </div>
      </div>

      {/* Menu Gallery */}
      {restaurant.menu_images.length > 0 && (
        <div className="px-4 pb-3">
          <ImageGallery images={restaurant.menu_images} />
        </div>
      )}

      {/* Call Waiter Button */}
      <div className="px-4 pb-4">
        {hasActiveCall ? (
          <div className="w-full py-3 rounded-xl bg-emerald-50 text-emerald-700 text-center font-semibold text-sm">
            ✓ Waiter called
          </div>
        ) : (
          <button
            onClick={onCallWaiter}
            disabled={isCalling || disabled}
            className={cn(
              "w-full py-3.5 rounded-xl font-semibold text-base transition-all duration-200 touch-target",
              "active:scale-[0.98]",
              isCalling || disabled
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-orange-200 hover:shadow-lg hover:shadow-orange-200"
            )}
          >
            {isCalling ? (
              <span className="flex items-center justify-center gap-2">
                <LoadingSpinner size="sm" className="text-white" />
                Calling...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <BellIcon />
                Call Waiter
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function CallStatusCard({
  activeCall,
  onCancel,
  cancelling,
}: {
  activeCall: ActiveCall;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const isPending = activeCall.status === "Pending";
  const isAccepted = activeCall.status === "Accepted";
  const isAttended = activeCall.status === "Attended";
  const isTerminal = ["Expired", "Cancelled"].includes(activeCall.status);

  return (
    <div
      className={cn(
        "rounded-2xl border-2 p-5 transition-all duration-300",
        isPending && "border-amber-300 bg-amber-50",
        isAccepted && "border-emerald-300 bg-emerald-50",
        isAttended && "border-blue-300 bg-blue-50",
        isTerminal && "border-gray-200 bg-gray-50"
      )}
    >
      {/* Status icon + text */}
      <div className="flex flex-col items-center text-center">
        {isPending && (
          <>
            <div className="relative mb-3">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                <BellIcon className="w-8 h-8 text-amber-600" />
              </div>
              <div className="absolute inset-0 rounded-full border-2 border-amber-300 animate-ping opacity-30" />
            </div>
            <h3 className="text-lg font-bold text-amber-800">
              Calling waiter...
            </h3>
            <p className="text-sm text-amber-600 mt-1">
              {activeCall.restaurant_name}
            </p>
            <p className="text-xs text-amber-500 mt-2">
              Waiting for a waiter to respond
            </p>
          </>
        )}

        {isAccepted && (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
              <svg
                className="w-8 h-8 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-emerald-800">
              Waiter is on the way!
            </h3>
            {activeCall.waiter_name && (
              <p className="text-base font-semibold text-emerald-700 mt-1">
                {activeCall.waiter_name}
              </p>
            )}
            <p className="text-sm text-emerald-600 mt-1">
              {activeCall.restaurant_name}
            </p>
          </>
        )}

        {isAttended && (
          <>
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-3">
              <svg
                className="w-8 h-8 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-blue-800">
              Visit complete
            </h3>
            <p className="text-sm text-blue-600 mt-1">
              Thank you for using our service!
            </p>
          </>
        )}

        {isTerminal && (
          <>
            <h3 className="text-base font-semibold text-gray-600">
              {activeCall.status === "Expired"
                ? "Call expired"
                : "Call cancelled"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              You can call a waiter again.
            </p>
          </>
        )}
      </div>

      {/* Cancel button (only when Pending) */}
      {isPending && (
        <button
          onClick={onCancel}
          disabled={cancelling}
          className="w-full mt-4 py-2.5 rounded-xl border border-amber-300 text-amber-700 font-medium text-sm hover:bg-amber-100 transition-colors"
        >
          {cancelling ? "Cancelling..." : "Cancel Call"}
        </button>
      )}
    </div>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("w-5 h-5", className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}
