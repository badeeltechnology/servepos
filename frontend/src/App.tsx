import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useFrappeAuth, useFrappeGetCall } from "frappe-react-sdk";
import { useState, createContext, useContext } from "react";

// Pages
import Dashboard from "@/pages/Dashboard";
import MenuManagement from "@/pages/MenuManagement";
import ModifierManagement from "@/pages/ModifierManagement";
import RestaurantSetup from "@/pages/RestaurantSetup";
import ItemVisibility from "@/pages/ItemVisibility";
import Waiters from "@/pages/Waiters";
import Promos from "@/pages/Promos";
import Vouchers from "@/pages/Vouchers";
import Reports from "@/pages/Reports";
import Layout from "@/components/Layout";

// Components
import { Toaster } from "@/components/ui/toaster";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

// POS Profile Context
interface ProfileContextType {
  profile: string;
  profileData: any;
  setProfile: (p: string) => void;
  setProfileData: (d: any) => void;
  isReporterOnly: boolean;
}

export const ProfileContext = createContext<ProfileContextType>({
  profile: "",
  profileData: null,
  setProfile: () => {},
  setProfileData: () => {},
  isReporterOnly: false,
});

export const useProfile = () => useContext(ProfileContext);

function App() {
  const { currentUser, isLoading } = useFrappeAuth();
  const [profile, setProfile] = useState("");
  const [profileData, setProfileData] = useState<any>(null);

  const { data: rolesData } = useFrappeGetCall<{ message: string[] }>(
    "frappe.client.get_list",
    {
      doctype: "Has Role",
      filters: { parent: currentUser || "", parenttype: "User" },
      fields: ["role"],
      limit_page_length: 0,
    },
  );
  const userRoles = (rolesData?.message || []).map((r: any) => r.role);
  const managerRoles = [
    "System Manager",
    "ServePOS Manager",
    "ServePOS Cashier",
    "ServePOS Waiter",
    "ServePOS Kitchen",
  ];
  const isReporterOnly =
    userRoles.length > 0 &&
    userRoles.includes("ServePOS Reporter") &&
    !managerRoles.some((r) => userRoles.includes(r));

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!currentUser || currentUser === "Guest") {
    window.location.href = "/login?redirect-to=/pos";
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const defaultRoute = isReporterOnly ? "/reports" : "/";

  return (
    <ProfileContext.Provider value={{ profile, profileData, setProfile, setProfileData, isReporterOnly }}>
      <BrowserRouter basename="/pos">
        <Routes>
          <Route element={<Layout />}>
            {isReporterOnly ? (
              <>
                <Route path="/reports" element={<Reports />} />
                <Route path="/" element={<Navigate to="/reports" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/menu" element={<MenuManagement />} />
                <Route path="/modifiers" element={<ModifierManagement />} />
                <Route path="/restaurant" element={<RestaurantSetup />} />
                <Route path="/visibility" element={<ItemVisibility />} />
                <Route path="/waiters" element={<Waiters />} />
                <Route path="/promos" element={<Promos />} />
                <Route path="/vouchers" element={<Vouchers />} />
                <Route path="/reports" element={<Reports />} />
              </>
            )}
          </Route>
          <Route path="*" element={<Navigate to={defaultRoute} replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </ProfileContext.Provider>
  );
}

export default App;
