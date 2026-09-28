import { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useProfile } from "@/App";
import {
  Package,
  ClipboardList,
  FilePlus,
  Layers,
  Settings,
  Menu,
  X,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, setProfile, profiles, isManager } = useProfile();
  const { logout } = useFrappeAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const selectedProfile = profiles.find((p) => p.name === profile);

  const navItems = [
    { to: "/", icon: Package, label: "Stock Overview" },
    { to: "/request", icon: FilePlus, label: "New Request" },
    { to: "/requests", icon: ClipboardList, label: "My Requests" },
    ...(isManager
      ? [
          { to: "/manage", icon: Layers, label: "All Requests" },
          { to: "/settings", icon: Settings, label: "Settings" },
        ]
      : []),
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 text-[10px] font-bold text-white">
              SS
            </div>
            <span className="text-[14px] font-semibold text-gray-900">
              ServeStore
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Branch selector */}
        <div className="border-b border-gray-200 px-3 py-3">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Branch
          </label>
          <div className="relative">
            <select
              value={profile || ""}
              onChange={(e) => setProfile(e.target.value)}
              className="w-full appearance-none rounded-md border border-gray-200 bg-white px-3 py-2 pr-8 text-[13px] font-medium text-gray-800 focus:border-gray-400 focus:outline-none"
            >
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          </div>
          {selectedProfile?.warehouse && (
            <p className="mt-1 text-[10px] text-gray-400">
              {selectedProfile.warehouse}
            </p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 px-3 py-3">
          <button
            onClick={() => {
              logout();
              window.location.href = "/login";
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile header */}
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden no-print">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded p-1 text-gray-600 hover:bg-gray-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-[13px] font-semibold text-gray-900">
            {navItems.find((n) => {
              if (n.to === "/") return location.pathname === "/";
              return location.pathname.startsWith(n.to);
            })?.label || "ServeStore"}
          </span>
          <div className="w-7" />
        </div>

        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
