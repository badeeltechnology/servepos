import { useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn, formatCurrency } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutGrid,
  Users,
  ArrowLeft,
  Clock,
  Sun,
  Moon,
  RefreshCw,
  Plus,
  Utensils,
  Sofa,
  TreePine,
  Lock,
} from "lucide-react";

interface Table {
  name: string;
  table_name: string;
  room: string;
  capacity: number;
  status: "Available" | "Occupied" | "Reserved" | "Cleaning";
}

interface Room {
  name: string;
  room_name: string;
  capacity: number;
  description?: string;
}

const roomIcons: Record<string, React.ReactNode> = {
  "Main Hall": <Utensils className="h-5 w-5" />,
  "Garden": <TreePine className="h-5 w-5" />,
  "Private Room": <Lock className="h-5 w-5" />,
  "Lounge": <Sofa className="h-5 w-5" />,
};

export default function TablesPage() {
  const { theme, toggleTheme } = useTheme();
  const [selectedRoom, setSelectedRoom] = useState<string>("All");

  // Fetch rooms
  const { data: rooms, isLoading: roomsLoading } = useFrappeGetDocList<Room>(
    "ServePOS Room",
    {
      fields: ["name", "room_name", "capacity", "description"],
      orderBy: { field: "room_name", order: "asc" },
    }
  );

  // Fetch tables
  const { data: tables, isLoading: tablesLoading, mutate: refreshTables } = useFrappeGetDocList<Table>(
    "ServePOS Table",
    {
      fields: ["name", "table_name", "room", "capacity", "status"],
      orderBy: { field: "table_name", order: "asc" },
    }
  );

  // Fetch active orders to show on occupied tables
  const { data: activeOrders } = useFrappeGetDocList(
    "POS Invoice",
    {
      fields: ["name", "servepos_table", "grand_total", "creation"],
      filters: [
        ["docstatus", "=", 1],
        ["status", "!=", "Consolidated"],
      ],
    }
  );

  // Theme classes
  const bgMain = theme === "dark" ? "bg-zinc-950" : "bg-gray-100";
  const bgCard = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const bgButton = theme === "dark" ? "bg-zinc-800" : "bg-gray-200";
  const bgButtonHover = theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";
  const borderColor = theme === "dark" ? "border-zinc-800" : "border-gray-200";
  const textMain = theme === "dark" ? "text-white" : "text-gray-900";
  const textMuted = theme === "dark" ? "text-zinc-400" : "text-gray-500";

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Available":
        return "border-green-500 bg-green-500/20 hover:bg-green-500/30";
      case "Occupied":
        return "border-red-500 bg-red-500/20 hover:bg-red-500/30";
      case "Reserved":
        return "border-yellow-500 bg-yellow-500/20 hover:bg-yellow-500/30";
      case "Cleaning":
        return "border-blue-500 bg-blue-500/20 hover:bg-blue-500/30";
      default:
        return cn("border-gray-300", bgCard);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Occupied":
        return <Utensils className="h-4 w-4 text-red-500" />;
      case "Reserved":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  // Get order for a table
  const getTableOrder = (tableName: string) => {
    return activeOrders?.find((o) => o.servepos_table === tableName);
  };

  // Filter tables by room
  const filteredTables = selectedRoom === "All"
    ? tables
    : tables?.filter((t) => t.room === selectedRoom);

  // Count stats
  const availableCount = tables?.filter((t) => t.status === "Available").length || 0;
  const occupiedCount = tables?.filter((t) => t.status === "Occupied").length || 0;
  const reservedCount = tables?.filter((t) => t.status === "Reserved").length || 0;

  if (roomsLoading || tablesLoading) {
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
              <LayoutGrid className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Table Management</h1>
              <p className={cn("text-xs", textMuted)}>{tables?.length || 0} tables</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-lg bg-green-500/20 px-3 py-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-green-500">{availableCount} Available</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-red-500/20 px-3 py-1.5">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-red-500">{occupiedCount} Occupied</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-yellow-500/20 px-3 py-1.5">
            <div className="h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-sm font-medium text-yellow-500">{reservedCount} Reserved</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshTables()}
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

      {/* Room Tabs */}
      <div className={cn("flex gap-2 border-b p-3 overflow-x-auto", borderColor)}>
        <button
          onClick={() => setSelectedRoom("All")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap",
            selectedRoom === "All"
              ? "bg-orange-500 text-white"
              : cn(bgButton, textMuted, bgButtonHover)
          )}
        >
          <LayoutGrid className="h-4 w-4" />
          All Rooms
        </button>
        {rooms?.map((room) => (
          <button
            key={room.name}
            onClick={() => setSelectedRoom(room.name)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap",
              selectedRoom === room.name
                ? "bg-orange-500 text-white"
                : cn(bgButton, textMuted, bgButtonHover)
            )}
          >
            {roomIcons[room.room_name] || <LayoutGrid className="h-4 w-4" />}
            {room.room_name}
          </button>
        ))}
      </div>

      {/* Tables Grid */}
      <main className="flex-1 overflow-auto p-6">
        {!tables?.length ? (
          <div className={cn("flex h-full flex-col items-center justify-center gap-4", textMuted)}>
            <LayoutGrid className="h-16 w-16" />
            <p className="text-xl">No tables configured</p>
            <a
              href="/app/servepos-table"
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              <Plus className="mr-2 inline-block h-4 w-4" />
              Add Tables
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {filteredTables?.map((table) => {
              const order = getTableOrder(table.name);
              return (
                <button
                  key={table.name}
                  className={cn(
                    "relative flex h-32 flex-col items-center justify-center rounded-xl border-2 p-3 transition-all hover:scale-105",
                    getStatusColor(table.status)
                  )}
                  onClick={() => {
                    if (table.status === "Available") {
                      window.location.href = `/pos?table=${table.name}`;
                    }
                  }}
                >
                  {/* Status Icon */}
                  {getStatusIcon(table.status) && (
                    <div className="absolute right-2 top-2">
                      {getStatusIcon(table.status)}
                    </div>
                  )}

                  {/* Table Name */}
                  <span className="text-2xl font-bold">{table.table_name}</span>

                  {/* Capacity */}
                  <div className={cn("flex items-center gap-1 text-sm", textMuted)}>
                    <Users className="h-3 w-3" />
                    <span>{table.capacity}</span>
                  </div>

                  {/* Order Info (if occupied) */}
                  {order && (
                    <div className="mt-1 text-xs text-orange-500 font-medium">
                      {formatCurrency(order.grand_total)}
                    </div>
                  )}

                  {/* Status Badge */}
                  <span className={cn(
                    "mt-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    table.status === "Available" && "bg-green-500 text-white",
                    table.status === "Occupied" && "bg-red-500 text-white",
                    table.status === "Reserved" && "bg-yellow-500 text-white",
                    table.status === "Cleaning" && "bg-blue-500 text-white"
                  )}>
                    {table.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* Quick Actions Footer */}
      <div className={cn("flex items-center justify-between border-t p-4", borderColor, bgCard)}>
        <div className={cn("text-sm", textMuted)}>
          Click on an available table to start a new order
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/app/servepos-table"
            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
          >
            <Plus className="h-4 w-4" />
            Manage Tables
          </a>
          <a
            href="/app/servepos-room"
            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
          >
            <Plus className="h-4 w-4" />
            Manage Rooms
          </a>
        </div>
      </div>
    </div>
  );
}
