import { useFrappeGetDocList, useFrappeGetDocCount } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const { profile, profileData } = useProfile();

  const { data: menuGroups } = useFrappeGetDocList("Item Group", {
    fields: ["name"],
    filters: [["servepos_is_menu_group", "=", 1]],
    limit: 100,
  });
  const menuGroupNames = menuGroups?.map((g: any) => g.name) || [];

  const { data: itemCount } = useFrappeGetDocCount(
    "Item",
    menuGroupNames.length > 0
      ? [["disabled", "=", 0], ["item_group", "in", menuGroupNames]]
      : [["disabled", "=", 0]]
  );

  const branch = (profileData as any)?.branch;
  const { data: tableCount } = useFrappeGetDocCount("ServePOS Table", branch ? [["branch", "=", branch]] : []);
  const { data: modGroupCount } = useFrappeGetDocCount("ServePOS Modifier Group");

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{profile === "__all__" ? "All Profiles" : profile}</h1>
        {profile !== "__all__" && (
          <p className="text-sm text-gray-500">
            {(profileData as any)?.company}
            {branch && ` · ${branch}`}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        {[
          { label: "Menu Items", value: itemCount ?? 0, to: "/menu" },
          { label: "Categories", value: menuGroupNames.length, to: "/menu" },
          { label: "Modifiers", value: modGroupCount ?? 0, to: "/modifiers" },
          { label: "Tables", value: tableCount ?? 0, to: "/restaurant" },
        ].map((s) => (
          <Link key={s.label} to={s.to} className="rounded-lg border border-gray-200 bg-white p-5 hover:border-gray-300 transition-colors">
            <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
            <p className="mt-1 text-[13px] text-gray-500">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick links */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-gray-700">Quick Actions</h2>
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-200">
          <Link to="/menu" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-600 text-xs font-bold">+</span>
            Add menu item
          </Link>
          <Link to="/modifiers" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-600 text-xs font-bold">+</span>
            Create modifier group
          </Link>
          <Link to="/restaurant" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 border-t border-gray-200 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600 text-xs font-bold">+</span>
            Add table or room
          </Link>
          <Link to="/visibility" className="flex items-center gap-3 px-5 py-4 text-[13px] text-gray-600 hover:bg-gray-50 border-t border-gray-200 transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-green-50 text-green-600 text-xs font-bold">→</span>
            Manage visibility
          </Link>
        </div>
      </div>

      {/* Categories */}
      {menuGroupNames.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-3">
            <h2 className="text-[13px] font-semibold text-gray-700">Menu Categories</h2>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {menuGroupNames.map((name: string) => (
              <span key={name} className="rounded-md bg-gray-100 px-3 py-1.5 text-[12px] font-medium text-gray-600">{name}</span>
            ))}
          </div>
        </div>
      )}

      {menuGroupNames.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No menu categories configured</p>
          <p className="mt-1 text-[12px] text-gray-400">
            Go to ERPNext → Item Group → check "Is Menu Group (ServePOS)" on your restaurant categories
          </p>
        </div>
      )}
    </div>
  );
}
