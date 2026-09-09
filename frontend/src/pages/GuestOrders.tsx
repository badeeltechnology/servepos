import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";

interface OrderItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  modifiers: string;
  special_instructions: string;
}

interface GuestOrder {
  name: string;
  status: string;
  creation: string;
  notes: string;
  items: OrderItem[];
}

interface GuestOrdersProps {
  seatCode: string;
  token: string;
  currency?: string;
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

export default function GuestOrders({ seatCode, token, currency = "" }: GuestOrdersProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<GuestOrder[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const result = await guestApi("get_guest_orders", {
          seat_code: seatCode,
          token,
        });
        setOrders(result || []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();

    // Refresh every 10 seconds
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [seatCode, token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    Pending: "bg-amber-100 text-amber-700",
    Accepted: "bg-blue-100 text-blue-700",
    "In Kitchen": "bg-orange-100 text-orange-700",
    Ready: "bg-emerald-100 text-emerald-700",
    Served: "bg-green-100 text-green-700",
    Paid: "bg-gray-100 text-gray-600",
    Cancelled: "bg-red-100 text-red-700",
  };

  return (
    <div className="pb-8">
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(`/${seatCode}`)}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-xl font-bold text-gray-900">Your Orders</h2>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-12 px-6">
          <div className="text-5xl mb-3">📋</div>
          <p className="text-gray-500">No orders yet</p>
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {orders.map((order) => {
            const total = order.items.reduce((sum, i) => sum + i.rate * i.qty, 0);
            return (
              <div
                key={order.name}
                className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-400 font-mono">
                    #{order.name}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold px-2.5 py-1 rounded-full",
                      statusColors[order.status] || "bg-gray-100 text-gray-600"
                    )}
                  >
                    {order.status}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {order.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-700">
                        {item.qty}x {item.item_name}
                        {item.modifiers && (
                          <span className="text-gray-400 text-xs ml-1">
                            ({item.modifiers})
                          </span>
                        )}
                      </span>
                      <span className="text-gray-600 font-medium">
                        {currency} {(item.rate * item.qty).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between">
                  <span className="text-sm font-semibold text-gray-700">Total</span>
                  <span className="text-sm font-bold text-gray-900">
                    {currency} {total.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
