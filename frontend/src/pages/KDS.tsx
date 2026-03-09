import { useState, useEffect } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn, formatTimeElapsed } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {
  ChefHat,
  Clock,
  RefreshCw,
  ArrowLeft,
  CheckCircle,
  UtensilsCrossed,
  Coffee,
  Flame,
  Sun,
  Moon,
} from "lucide-react";

interface InvoiceItem {
  parent: string;
  item_code: string;
  item_name: string;
  qty: number;
  servepos_modifiers?: string;
  servepos_comment?: string;
  servepos_kot_status?: string;
  servepos_kitchen_station?: string;
}

const stationIcons: Record<string, React.ReactNode> = {
  "Main Kitchen": <Flame className="h-5 w-5" />,
  "Grill": <UtensilsCrossed className="h-5 w-5" />,
  "Bar": <Coffee className="h-5 w-5" />,
  "Dessert": <ChefHat className="h-5 w-5" />,
};

export default function KDSPage() {
  const { theme, toggleTheme } = useTheme();
  const [selectedStation, setSelectedStation] = useState<string>("All");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch pending KOTs (using POS Invoice items as reference)
  const { data: posInvoices, isLoading, mutate } = useFrappeGetDocList(
    "POS Invoice",
    {
      fields: ["name", "servepos_table", "servepos_order_type", "creation", "status"],
      filters: [
        ["docstatus", "=", 1],
        ["status", "!=", "Consolidated"],
      ],
      orderBy: { field: "creation", order: "asc" },
      limit: 50,
    }
  );

  // Fetch POS Invoice Items
  const { data: invoiceItems } = useFrappeGetDocList(
    "POS Invoice Item",
    {
      fields: ["parent", "item_code", "item_name", "qty", "servepos_modifiers", "servepos_comment", "servepos_kot_status"],
      filters: posInvoices?.length
        ? [
            ["parent", "in", posInvoices.map((i) => i.name)],
            ["servepos_kot_status", "in", ["Pending", "In Progress", ""]],
          ]
        : [["parent", "=", ""]],
      limit: 200,
    }
  );

  // Auto refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      mutate();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, mutate]);

  // Group items by invoice
  const ordersByInvoice = posInvoices?.map((invoice) => ({
    ...invoice,
    items: invoiceItems?.filter((item) => item.parent === invoice.name) || [],
  })).filter((order) => order.items.length > 0) || [];

  // Get unique stations
  const stations = ["All", "Main Kitchen", "Grill", "Bar", "Dessert"];

  // Filter by station
  const filteredOrders = selectedStation === "All"
    ? ordersByInvoice
    : ordersByInvoice.filter((order) =>
        order.items.some((item: InvoiceItem) => item.servepos_kitchen_station === selectedStation)
      );

  // Get time-based status color
  const getOrderStatusColor = (creation: string) => {
    const createdAt = new Date(creation);
    const now = new Date();
    const diffMins = (now.getTime() - createdAt.getTime()) / 60000;

    if (diffMins >= 20) return "border-red-500 bg-red-500/10";
    if (diffMins >= 10) return "border-yellow-500 bg-yellow-500/10";
    return "border-green-500 bg-green-500/10";
  };

  // Theme classes
  const bgMain = theme === "dark" ? "bg-zinc-950" : "bg-gray-100";
  const bgCard = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const bgButton = theme === "dark" ? "bg-zinc-800" : "bg-gray-200";
  const bgButtonHover = theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";
  const borderColor = theme === "dark" ? "border-zinc-800" : "border-gray-200";
  const textMain = theme === "dark" ? "text-white" : "text-gray-900";
  const textMuted = theme === "dark" ? "text-zinc-400" : "text-gray-500";

  // Update KOT status
  const updateItemStatus = async (parent: string, itemCode: string, newStatus: string) => {
    try {
      await fetch(`/api/method/frappe.client.set_value`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": window.csrf_token || "",
        },
        body: JSON.stringify({
          doctype: "POS Invoice Item",
          name: `${parent}-${itemCode}`,
          fieldname: "servepos_kot_status",
          value: newStatus,
        }),
      });
      mutate();
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const markOrderComplete = async (invoiceName: string) => {
    // Mark all items as completed
    const items = invoiceItems?.filter((item) => item.parent === invoiceName) || [];
    for (const item of items) {
      await updateItemStatus(invoiceName, item.item_code, "Completed");
    }
    mutate();
  };

  if (isLoading) {
    return (
      <div className={cn("flex h-screen items-center justify-center", bgMain)}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className={cn("flex h-screen flex-col", bgMain, textMain)}>
      {/* Header */}
      <header className={cn("flex h-16 items-center justify-between border-b px-4", borderColor, bgCard)}>
        <div className="flex items-center gap-4">
          <a
            href="/pos"
            className={cn("flex items-center gap-2 rounded-lg px-3 py-2", bgButton, bgButtonHover)}
          >
            <ArrowLeft className="h-4 w-4" />
            POS
          </a>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-white">
              <ChefHat className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Kitchen Display</h1>
              <p className={cn("text-xs", textMuted)}>{filteredOrders.length} active orders</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              autoRefresh ? "bg-green-500 text-white" : cn(bgButton, bgButtonHover)
            )}
          >
            <RefreshCw className={cn("h-4 w-4", autoRefresh && "animate-spin")} />
            Auto
          </button>
          <button
            onClick={() => mutate()}
            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={toggleTheme}
            className={cn("flex h-9 w-9 items-center justify-center rounded-lg", bgButton, bgButtonHover)}
          >
            {theme === "dark" ? <Sun className="h-4 w-4 text-yellow-500" /> : <Moon className="h-4 w-4 text-blue-600" />}
          </button>
        </div>
      </header>

      {/* Station Tabs */}
      <div className={cn("flex gap-2 border-b p-3 overflow-x-auto", borderColor)}>
        {stations.map((station) => (
          <button
            key={station}
            onClick={() => setSelectedStation(station)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap",
              selectedStation === station
                ? "bg-orange-500 text-white"
                : cn(bgButton, textMuted, bgButtonHover)
            )}
          >
            {stationIcons[station] || <ChefHat className="h-4 w-4" />}
            {station}
          </button>
        ))}
      </div>

      {/* KOT Cards Grid */}
      <main className="flex-1 overflow-auto p-4">
        {!filteredOrders.length ? (
          <div className={cn("flex h-full flex-col items-center justify-center", textMuted)}>
            <ChefHat className="mb-4 h-16 w-16" />
            <p className="text-xl">No pending orders</p>
            <p className="text-sm">All caught up!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredOrders.map((order) => (
              <div
                key={order.name}
                className={cn(
                  "rounded-xl border-2 p-4 transition-all",
                  getOrderStatusColor(order.creation),
                  bgCard
                )}
              >
                {/* Order Header */}
                <div className={cn("mb-3 flex items-center justify-between border-b pb-3", borderColor)}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold">
                        {order.servepos_table || "Counter"}
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs", bgButton)}>
                        {order.servepos_order_type}
                      </span>
                    </div>
                    <span className={cn("text-xs", textMuted)}>
                      #{order.name.slice(-6)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-orange-500" />
                    <span className="font-mono text-sm font-medium">
                      {formatTimeElapsed(order.creation)}
                    </span>
                  </div>
                </div>

                {/* Order Items */}
                <ul className="mb-4 space-y-2">
                  {order.items.map((item: InvoiceItem, idx: number) => (
                    <li key={idx} className={cn("rounded-lg p-2", bgButton)}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">
                            {item.qty}
                          </span>
                          <span className="font-medium">{item.item_name}</span>
                        </div>
                        {item.servepos_kot_status === "In Progress" && (
                          <Flame className="h-4 w-4 text-orange-500 animate-pulse" />
                        )}
                      </div>
                      {item.servepos_modifiers && (
                        <p className="ml-8 text-xs text-orange-500">+ {item.servepos_modifiers}</p>
                      )}
                      {item.servepos_comment && (
                        <p className={cn("ml-8 text-xs italic", textMuted)}>"{item.servepos_comment}"</p>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Order Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => markOrderComplete(order.name)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-3 text-sm font-semibold text-white hover:bg-green-600"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Complete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Status Legend */}
      <div className={cn("flex items-center justify-center gap-6 border-t py-3", borderColor, bgCard)}>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-green-500" />
          <span className={cn("text-xs", textMuted)}>{"< 10 min"}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-yellow-500" />
          <span className={cn("text-xs", textMuted)}>10-20 min</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          <span className={cn("text-xs", textMuted)}>{"> 20 min"}</span>
        </div>
      </div>
    </div>
  );
}
