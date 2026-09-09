import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";
import type { CartItem } from "./GuestMenu";

interface GuestCartProps {
  seatCode: string;
  posProfile: string;
  token: string;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  restaurantName: string;
  currency?: string;
}

// API helper
async function guestApi(method: string, args: Record<string, any>) {
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

export default function GuestCart({
  seatCode,
  posProfile,
  token,
  cart,
  setCart,
  restaurantName,
  currency = "",
}: GuestCartProps) {
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    order_name: string;
    status: string;
    message: string;
  } | null>(null);
  const [orderStatus, setOrderStatus] = useState("");

  const cartTotal = useMemo(
    () => cart.reduce((sum, ci) => sum + (ci.rate + ci.modifier_total) * ci.qty, 0),
    [cart]
  );

  const updateQty = useCallback(
    (idx: number, delta: number) => {
      setCart((prev) => {
        const updated = [...prev];
        const newQty = updated[idx].qty + delta;
        if (newQty <= 0) {
          updated.splice(idx, 1);
        } else {
          updated[idx] = { ...updated[idx], qty: newQty };
        }
        return updated;
      });
    },
    [setCart]
  );

  const removeItem = useCallback(
    (idx: number) => {
      setCart((prev) => prev.filter((_, i) => i !== idx));
    },
    [setCart]
  );

  const placeOrder = useCallback(async () => {
    if (cart.length === 0) return;

    setPlacing(true);
    try {
      const result = await guestApi("place_guest_order", {
        seat_code: seatCode,
        pos_profile: posProfile,
        token,
        items: JSON.stringify(
          cart.map((ci) => ({
            item_code: ci.item_code,
            qty: ci.qty,
            modifiers: ci.modifiers,
            modifier_total: ci.modifier_total,
            special_instructions: ci.special_instructions,
          }))
        ),
        notes,
      });

      // If payment is required, redirect to QIB checkout
      if (result.requires_payment && result.checkout_url) {
        setCart([]);
        window.location.href = result.checkout_url;
        return;
      }

      // No payment required — show order status directly
      setOrderResult(result);
      setOrderStatus(result.status);
      setCart([]);
    } catch (e: any) {
      alert(e.message || "Failed to place order. Please try again.");
    } finally {
      setPlacing(false);
    }
  }, [cart, seatCode, posProfile, token, notes, setCart]);

  // Poll order status after placing
  useEffect(() => {
    if (!orderResult) return;

    const interval = setInterval(async () => {
      try {
        const result = await guestApi("get_guest_order_status", {
          order_name: orderResult.order_name,
          token,
        });
        setOrderStatus(result.status);
        if (["Served", "Paid", "Cancelled"].includes(result.status)) {
          clearInterval(interval);
        }
      } catch {
        // Silently ignore poll errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [orderResult, token]);

  // Order placed — show status
  if (orderResult) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <OrderStatusView
            orderName={orderResult.order_name}
            status={orderStatus}
            message={orderResult.message}
            currency={currency}
            onBackToMenu={() => navigate(`/${seatCode}/menu/${posProfile}`)}
            onViewOrders={() => navigate(`/${seatCode}/orders`)}
          />
        </div>
      </div>
    );
  }

  // Empty cart
  if (cart.length === 0) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6">
        <div className="text-6xl mb-4">🛒</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          Your cart is empty
        </h2>
        <p className="text-gray-500 text-center mb-6">
          Browse the menu and add items to get started
        </p>
        <button
          onClick={() => navigate(`/${seatCode}/menu/${posProfile}`)}
          className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold shadow-md"
        >
          Browse Menu
        </button>
      </div>
    );
  }

  return (
    <div className="pb-32">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/${seatCode}/menu/${posProfile}`)}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Your Cart</h2>
            <p className="text-sm text-gray-500">{restaurantName}</p>
          </div>
        </div>
      </div>

      {/* Cart Items */}
      <div className="px-4 py-2 space-y-3">
        {cart.map((ci, idx) => (
          <div key={`${ci.item_code}-${idx}`} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="flex gap-3">
              {ci.image ? (
                <img
                  src={ci.image}
                  alt={ci.item_name}
                  className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">🍽️</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-gray-900 line-clamp-2">
                    {ci.item_name}
                  </h3>
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-gray-400 hover:text-red-500 ml-2 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {ci.modifiers && (
                  <p className="text-xs text-gray-500 mt-0.5">{ci.modifiers}</p>
                )}
                {ci.special_instructions && (
                  <p className="text-xs text-amber-600 mt-0.5 italic">
                    "{ci.special_instructions}"
                  </p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center bg-gray-100 rounded-lg">
                    <button
                      onClick={() => updateQty(idx, -1)}
                      className="w-8 h-8 flex items-center justify-center text-gray-600 font-bold"
                    >
                      -
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">
                      {ci.qty}
                    </span>
                    <button
                      onClick={() => updateQty(idx, 1)}
                      className="w-8 h-8 flex items-center justify-center text-gray-600 font-bold"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm font-bold text-gray-900">
                    {currency} {((ci.rate + ci.modifier_total) * ci.qty).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Order Notes */}
      <div className="px-4 py-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add a note for the restaurant..."
          maxLength={500}
          rows={2}
          className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
        />
      </div>

      {/* Order Summary */}
      <div className="px-4 py-2">
        <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Subtotal</span>
            <span>{currency} {cartTotal.toFixed(2)}</span>
          </div>
          <div className="border-t border-amber-200 my-2" />
          <div className="flex justify-between text-base font-bold text-gray-900">
            <span>Total</span>
            <span>{currency} {cartTotal.toFixed(2)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            You may be redirected to complete payment online
          </p>
        </div>
      </div>

      {/* Place Order Button */}
      <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-gradient-to-t from-white via-white to-transparent pt-8">
        <button
          onClick={placeOrder}
          disabled={placing || cart.length === 0}
          className={cn(
            "w-full max-w-lg mx-auto flex items-center justify-center py-4 rounded-2xl font-semibold text-base shadow-lg transition-all duration-200 active:scale-[0.98]",
            placing
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-green-200"
          )}
        >
          {placing ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner size="sm" className="text-white" />
              Placing order...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span>Place Order</span>
              <span>— {currency} {cartTotal.toFixed(2)}</span>
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

// --- Order Status View ---

function OrderStatusView({
  orderName,
  status,
  message,
  currency,
  onBackToMenu,
  onViewOrders,
}: {
  orderName: string;
  status: string;
  message: string;
  currency: string;
  onBackToMenu: () => void;
  onViewOrders: () => void;
}) {
  const statusConfig: Record<string, { icon: string; color: string; label: string; description: string }> = {
    Pending: {
      icon: "clock",
      color: "amber",
      label: "Order Received",
      description: "Your order has been placed and is waiting to be confirmed.",
    },
    Accepted: {
      icon: "check",
      color: "blue",
      label: "Order Confirmed",
      description: "Your order has been accepted and is being prepared.",
    },
    "In Kitchen": {
      icon: "fire",
      color: "orange",
      label: "Being Prepared",
      description: "Your order is being prepared in the kitchen.",
    },
    Ready: {
      icon: "bell",
      color: "emerald",
      label: "Ready to Serve",
      description: "Your order is ready and will be served shortly!",
    },
    Served: {
      icon: "done",
      color: "green",
      label: "Served",
      description: "Your order has been served. Enjoy your meal!",
    },
    Cancelled: {
      icon: "x",
      color: "red",
      label: "Cancelled",
      description: "This order has been cancelled.",
    },
  };

  const config = statusConfig[status] || statusConfig.Pending;

  const statusSteps = ["Pending", "Accepted", "In Kitchen", "Ready", "Served"];
  const currentStep = statusSteps.indexOf(status);

  return (
    <div className="text-center">
      {/* Status Icon */}
      <div className={cn(
        "w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center",
        config.color === "amber" && "bg-amber-100",
        config.color === "blue" && "bg-blue-100",
        config.color === "orange" && "bg-orange-100",
        config.color === "emerald" && "bg-emerald-100",
        config.color === "green" && "bg-green-100",
        config.color === "red" && "bg-red-100",
      )}>
        {status === "Pending" && (
          <div className="relative">
            <svg className="w-10 h-10 text-amber-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )}
        {status === "Accepted" && (
          <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {status === "In Kitchen" && (
          <span className="text-4xl">🔥</span>
        )}
        {status === "Ready" && (
          <span className="text-4xl">🔔</span>
        )}
        {status === "Served" && (
          <span className="text-4xl">✅</span>
        )}
        {status === "Cancelled" && (
          <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-1">{config.label}</h2>
      <p className="text-sm text-gray-500 mb-2">{config.description}</p>
      <p className="text-xs text-gray-400 mb-6">Order #{orderName}</p>

      {/* Progress Steps */}
      {status !== "Cancelled" && (
        <div className="flex items-center justify-center gap-1 mb-8 px-4">
          {statusSteps.map((step, i) => (
            <div key={step} className="flex items-center">
              <div
                className={cn(
                  "w-2.5 h-2.5 rounded-full transition-colors",
                  i <= currentStep ? "bg-emerald-500" : "bg-gray-200"
                )}
              />
              {i < statusSteps.length - 1 && (
                <div
                  className={cn(
                    "w-8 h-0.5 transition-colors",
                    i < currentStep ? "bg-emerald-500" : "bg-gray-200"
                  )}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        <button
          onClick={onBackToMenu}
          className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold shadow-md active:scale-[0.98] transition-transform"
        >
          Order More Items
        </button>
        <button
          onClick={onViewOrders}
          className="w-full py-3 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
        >
          View All Orders
        </button>
      </div>
    </div>
  );
}
