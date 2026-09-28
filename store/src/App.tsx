import { createContext, useContext, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useFrappeAuth, useFrappeGetDocList } from "frappe-react-sdk";
import Layout from "@/components/Layout";
import StockOverview from "@/pages/StockOverview";
import NewRequest from "@/pages/NewRequest";
import MyRequests from "@/pages/MyRequests";
import RequestDetail from "@/pages/RequestDetail";
import ConsolidatedView from "@/pages/ConsolidatedView";
import ProcessRequest from "@/pages/ProcessRequest";
import Settings from "@/pages/Settings";

// --- Profile Context ---
interface ProfileContextType {
  profile: string | null;
  setProfile: (p: string) => void;
  profiles: any[];
  isManager: boolean;
  userRoles: string[];
}

const ProfileContext = createContext<ProfileContextType>({
  profile: null,
  setProfile: () => {},
  profiles: [],
  isManager: false,
  userRoles: [],
});

export const useProfile = () => useContext(ProfileContext);

export default function App() {
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const [profile, setProfile] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);

  // Fetch POS profiles for branch selection
  const { data: profiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "branch", "warehouse", "company"],
    limit: 50,
  });

  // Fetch user roles
  useEffect(() => {
    if (currentUser) {
      fetch(`/api/method/frappe.client.get_list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": window.csrf_token || "" },
        body: JSON.stringify({ doctype: "Has Role", filters: { parent: currentUser }, fields: ["role"], limit_page_length: 100 }),
      })
        .then((r) => r.json())
        .then((d) => {
          const roles = (d.message || []).map((r: any) => r.role);
          setUserRoles(roles);
        })
        .catch(() => {});
    }
  }, [currentUser]);

  // Auto-select first profile
  useEffect(() => {
    if (profiles?.length && !profile) {
      setProfile(profiles[0].name);
    }
  }, [profiles, profile]);

  const isManager = userRoles.some((r) =>
    ["System Manager", "ServePOS Manager"].includes(r)
  );

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!currentUser || currentUser === "Guest") {
    window.location.href = "/login?redirect-to=/store";
    return null;
  }

  return (
    <ProfileContext.Provider value={{ profile, setProfile, profiles: profiles || [], isManager, userRoles }}>
      <BrowserRouter basename="/store">
        <Layout>
          <Routes>
            <Route path="/" element={<StockOverview />} />
            <Route path="/request" element={<NewRequest />} />
            <Route path="/requests" element={<MyRequests />} />
            <Route path="/requests/:id" element={<RequestDetail />} />
            {isManager && <Route path="/manage" element={<ConsolidatedView />} />}
            {isManager && <Route path="/manage/:id" element={<ProcessRequest />} />}
            {isManager && <Route path="/settings" element={<Settings />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ProfileContext.Provider>
  );
}
