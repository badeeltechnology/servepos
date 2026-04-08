import { NavLink, Outlet } from "react-router-dom";
import { useFrappeAuth, useFrappeGetDocList, useFrappeGetDoc } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { useEffect } from "react";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Package,
  Building2,
  Eye,
  Tag,
  LogOut,
  ChevronDown,
  ExternalLink,
  Users,
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Overview", end: true },
  { to: "/menu", icon: UtensilsCrossed, label: "Menu Items", end: false },
  { to: "/modifiers", icon: Package, label: "Modifiers", end: false },
  { to: "/restaurant", icon: Building2, label: "Tables & Rooms", end: false },
  { to: "/visibility", icon: Eye, label: "Visibility", end: false },
  { to: "/waiters", icon: Users, label: "Waiters", end: false },
  { to: "/promos", icon: Tag, label: "Promos", end: false },
];

export default function Layout() {
  const { currentUser, logout } = useFrappeAuth();
  const { profile, setProfile, setProfileData } = useProfile();

  const { data: profiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "company", "branch", "warehouse"],
    limit: 50,
  });

  const { data: profileDoc } = useFrappeGetDoc("POS Profile", profile || "___none___");

  useEffect(() => {
    if (profiles && profiles.length > 0 && !profile) setProfile(profiles[0].name);
  }, [profiles]);

  useEffect(() => {
    if (profileDoc) setProfileData(profileDoc);
  }, [profileDoc]);

  return (
    <div className="flex h-screen bg-[#f8f9fb]">
      {/* Sidebar */}
      <aside className="flex w-[240px] flex-col border-r border-gray-200 bg-white">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-5">
          <div className="h-7 w-7 rounded-lg bg-[#1a1a2e] flex items-center justify-center">
            <span className="text-[10px] font-black text-white">SP</span>
          </div>
          <span className="text-sm font-bold text-gray-900">ServePOS</span>
        </div>

        {/* Profile selector */}
        <div className="border-b border-gray-200 p-4">
          <label className="mb-1 block text-[11px] font-medium text-gray-400">POS PROFILE</label>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-medium text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            <option value="">Select...</option>
            <option value="__all__">All Profiles</option>
            {profiles?.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          {profile === "__all__" && (
            <p className="mt-1.5 text-[11px] text-gray-400">Viewing all restaurants</p>
          )}
          {profile && profile !== "__all__" && profileDoc && (
            <p className="mt-1.5 text-[11px] text-gray-400">
              {(profileDoc as any).company}
              {(profileDoc as any).branch && ` · ${(profileDoc as any).branch}`}
            </p>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-gray-700 truncate">{currentUser}</p>
              <a href="/app" className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600">
                ERPNext <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <button onClick={() => logout()} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {!profile ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium text-gray-400">Select a POS Profile to get started</p>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
