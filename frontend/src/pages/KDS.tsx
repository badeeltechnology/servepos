import { useState, useEffect, useCallback } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn, formatTimeElapsed } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {
  ChefHat,
  Clock,
  RefreshCw,
  ArrowLeft,
  CheckCircle,
  Play,
  UtensilsCrossed,
  Coffee,
  Flame,
  Sun,
  Moon,
  AlertTriangle,
  Printer,
  History,
  ListOrdered,
} from "lucide-react";

interface KOTItem {
  name: string;
  item_code: string;
  item_name: string;
  qty: number;
  modifiers?: string;
  special_instructions?: string;
  status: string;
}

interface KOT {
  name: string;
  pos_invoice: string;
  kitchen_station: string;
  table?: string;
  table_name?: string;
  status: string;
  priority: string;
  order_time: string;
  notes?: string;
  items: KOTItem[];
}

interface Station {
  name: string;
  station_name: string;
  description?: string;
  display_order: number;
}

const stationIcons: Record<string, React.ReactNode> = {
  "Main Kitchen": <Flame className="h-5 w-5" />,
  "Grill": <UtensilsCrossed className="h-5 w-5" />,
  "Bar": <Coffee className="h-5 w-5" />,
  "Dessert Station": <ChefHat className="h-5 w-5" />,
};

const priorityColors: Record<string, string> = {
  "Normal": "",
  "High": "ring-2 ring-yellow-500",
  "Urgent": "ring-2 ring-red-500 animate-pulse",
};

export default function KDSPage() {
  const { theme, toggleTheme } = useTheme();
  const [selectedStation, setSelectedStation] = useState<string>("All");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [kots, setKots] = useState<KOT[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  // Fetch stations
  const { data: stationsData } = useFrappeGetCall<{ message: Station[] }>(
    "servepos.api.kot.get_all_stations"
  );

  // Fetch KOTs - different status filter for history vs active
  const { data: kotsData, mutate: refreshKots, isLoading } = useFrappeGetCall<{ message: KOT[] }>(
    "servepos.api.kot.get_kots_for_station",
    {
      station: selectedStation === "All" ? "" : selectedStation,
      status_filter: showHistory ? JSON.stringify(["Served", "Cancelled"]) : JSON.stringify(["Pending", "In Progress", "Ready"]),
    }
  );

  // API calls for status updates
  const { call: updateKotStatus } = useFrappePostCall("servepos.api.kot.update_kot_status");
  const { call: updateItemStatus } = useFrappePostCall("servepos.api.kot.update_kot_item_status");
  const { call: bumpKot } = useFrappePostCall("servepos.api.kot.bump_kot");

  // Update state when data changes
  useEffect(() => {
    if (stationsData?.message) {
      setStations(stationsData.message);
    }
  }, [stationsData]);

  useEffect(() => {
    if (kotsData?.message) {
      setKots(kotsData.message);
    }
  }, [kotsData]);

  // Real-time updates via Socket.io
  useEffect(() => {
    const socket = (window as any).frappe?.socketio;
    if (!socket) return;

    const room = selectedStation === "All" ? "kds_all" : `kds_${selectedStation}`;

    // Subscribe to KDS room
    socket.emit("doctype_subscribe", room);

    // Listen for new KOTs
    const handleNewKot = (data: any) => {
      if (selectedStation === "All" || data.station === selectedStation) {
        refreshKots();
      }
    };

    // Listen for status updates
    const handleStatusUpdate = (data: any) => {
      if (selectedStation === "All" || data.station === selectedStation) {
        refreshKots();
      }
    };

    socket.on("new_kot", handleNewKot);
    socket.on("kot_status_update", handleStatusUpdate);
    socket.on("kot_item_status_update", handleStatusUpdate);

    return () => {
      socket.emit("doctype_unsubscribe", room);
      socket.off("new_kot", handleNewKot);
      socket.off("kot_status_update", handleStatusUpdate);
      socket.off("kot_item_status_update", handleStatusUpdate);
    };
  }, [selectedStation, refreshKots]);

  // Auto refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refreshKots();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshKots]);

  // Handle start cooking (set to In Progress)
  const handleStartCooking = useCallback(async (kotName: string) => {
    await updateKotStatus({ kot_name: kotName, status: "In Progress" });
    refreshKots();
  }, [updateKotStatus, refreshKots]);

  // Handle bump (mark as Ready)
  const handleBump = useCallback(async (kotName: string) => {
    await bumpKot({ kot_name: kotName });
    refreshKots();
  }, [bumpKot, refreshKots]);

  // Handle item status update
  const handleItemClick = useCallback(async (kotName: string, itemName: string, currentStatus: string) => {
    const nextStatus = currentStatus === "Pending" ? "In Progress" :
                       currentStatus === "In Progress" ? "Ready" : currentStatus;
    if (nextStatus !== currentStatus) {
      await updateItemStatus({ kot_name: kotName, item_name: itemName, status: nextStatus });
      refreshKots();
    }
  }, [updateItemStatus, refreshKots]);

  // Print KOT
  const handlePrint = useCallback((kotName: string) => {
    window.open(`/api/method/frappe.utils.print_format.download_pdf?doctype=ServePOS%20KOT&name=${kotName}&format=ServePOS%20KOT`, "_blank");
  }, []);

  // Get time-based urgency color
  const getUrgencyColor = (orderTime: string, priority: string) => {
    if (priority === "Urgent") return "border-red-500 bg-red-500/10";
    if (priority === "High") return "border-yellow-500 bg-yellow-500/10";

    const createdAt = new Date(orderTime);
    const now = new Date();
    const diffMins = (now.getTime() - createdAt.getTime()) / 60000;

    if (diffMins >= 15) return "border-red-500 bg-red-500/10";
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

  // Filter KOTs by selected station
  const filteredKots = selectedStation === "All"
    ? kots
    : kots.filter((kot) => kot.kitchen_station === selectedStation);

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
              <h1 className="text-lg font-bold">Kitchen Display System</h1>
              <p className={cn("text-xs", textMuted)}>
                {filteredKots.length} {showHistory ? "completed orders" : "active orders"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* History Toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              showHistory ? "bg-purple-500 text-white" : cn(bgButton, bgButtonHover)
            )}
          >
            {showHistory ? <ListOrdered className="h-4 w-4" /> : <History className="h-4 w-4" />}
            {showHistory ? "Active" : "History"}
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              autoRefresh && !showHistory ? "bg-green-500 text-white" : cn(bgButton, bgButtonHover)
            )}
            disabled={showHistory}
          >
            <RefreshCw className={cn("h-4 w-4", autoRefresh && !showHistory && "animate-spin")} />
            Auto
          </button>
          <button
            onClick={() => refreshKots()}
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
        <button
          onClick={() => setSelectedStation("All")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap",
            selectedStation === "All"
              ? "bg-orange-500 text-white"
              : cn(bgButton, textMuted, bgButtonHover)
          )}
        >
          <ChefHat className="h-4 w-4" />
          All Stations
        </button>
        {stations.map((station) => (
          <button
            key={station.name}
            onClick={() => setSelectedStation(station.name)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap",
              selectedStation === station.name
                ? "bg-orange-500 text-white"
                : cn(bgButton, textMuted, bgButtonHover)
            )}
          >
            {stationIcons[station.station_name] || <ChefHat className="h-4 w-4" />}
            {station.station_name}
          </button>
        ))}
      </div>

      {/* KOT Cards Grid */}
      <main className="flex-1 overflow-auto p-4">
        {!filteredKots.length ? (
          <div className={cn("flex h-full flex-col items-center justify-center", textMuted)}>
            {showHistory ? <History className="mb-4 h-16 w-16" /> : <ChefHat className="mb-4 h-16 w-16" />}
            <p className="text-xl">{showHistory ? "No order history" : "No pending orders"}</p>
            <p className="text-sm">{showHistory ? "Completed orders will appear here" : "All caught up!"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredKots.map((kot) => (
              <div
                key={kot.name}
                className={cn(
                  "rounded-xl border-2 p-4 transition-all",
                  getUrgencyColor(kot.order_time, kot.priority),
                  priorityColors[kot.priority],
                  bgCard
                )}
              >
                {/* KOT Header */}
                <div className={cn("mb-3 flex items-center justify-between border-b pb-3", borderColor)}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold">
                        {kot.table_name || "Counter"}
                      </span>
                      {kot.priority !== "Normal" && (
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-bold",
                          kot.priority === "Urgent" ? "bg-red-500 text-white" : "bg-yellow-500 text-black"
                        )}>
                          {kot.priority}
                        </span>
                      )}
                    </div>
                    <span className={cn("text-xs", textMuted)}>
                      {kot.name} • {kot.kitchen_station}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 text-orange-500" />
                      <span className="font-mono text-sm font-medium">
                        {formatTimeElapsed(kot.order_time)}
                      </span>
                    </div>
                    <span className={cn(
                      "text-xs font-medium",
                      kot.status === "Pending" ? "text-yellow-500" : "text-blue-500"
                    )}>
                      {kot.status}
                    </span>
                  </div>
                </div>

                {/* KOT Items */}
                <ul className="mb-4 space-y-2">
                  {kot.items.map((item) => (
                    <li
                      key={item.name}
                      onClick={() => handleItemClick(kot.name, item.name, item.status)}
                      className={cn(
                        "rounded-lg p-2 cursor-pointer transition-colors",
                        item.status === "Ready" ? "bg-green-500/20" :
                        item.status === "In Progress" ? "bg-blue-500/20" :
                        bgButton
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">
                            {item.qty}
                          </span>
                          <span className="font-medium">{item.item_name}</span>
                        </div>
                        {item.status === "In Progress" && (
                          <Flame className="h-4 w-4 text-orange-500 animate-pulse" />
                        )}
                        {item.status === "Ready" && (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      {item.modifiers && (
                        <p className="ml-8 text-xs text-orange-500">+ {item.modifiers}</p>
                      )}
                      {item.special_instructions && (
                        <p className={cn("ml-8 text-xs italic", textMuted)}>"{item.special_instructions}"</p>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Notes */}
                {kot.notes && (
                  <div className={cn("mb-3 rounded-lg p-2 text-sm", bgButton)}>
                    <AlertTriangle className="mr-1 inline h-3 w-3 text-yellow-500" />
                    {kot.notes}
                  </div>
                )}

                {/* KOT Actions - Only show for active orders */}
                {!showHistory ? (
                  <div className="flex gap-2">
                    {kot.status === "Pending" && (
                      <button
                        onClick={() => handleStartCooking(kot.name)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-500 py-3 text-sm font-semibold text-white hover:bg-blue-600"
                      >
                        <Play className="h-4 w-4" />
                        Start
                      </button>
                    )}
                    <button
                      onClick={() => handleBump(kot.name)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-3 text-sm font-semibold text-white hover:bg-green-600"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Bump
                    </button>
                    <button
                      onClick={() => handlePrint(kot.name)}
                      className={cn("flex items-center justify-center rounded-lg px-3 py-3", bgButton, bgButtonHover)}
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className={cn("flex items-center justify-center gap-2 py-2 text-sm", textMuted)}>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    {kot.status}
                  </div>
                )}
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
          <span className={cn("text-xs", textMuted)}>10-15 min</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          <span className={cn("text-xs", textMuted)}>{"> 15 min"}</span>
        </div>
        <div className="mx-4 h-4 w-px bg-gray-400" />
        <div className={cn("text-xs", textMuted)}>Click item to update status</div>
      </div>
    </div>
  );
}
