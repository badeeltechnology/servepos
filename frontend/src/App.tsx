import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useFrappeAuth } from "frappe-react-sdk";
import { useState, createContext, useContext } from "react";

// Pages
import Dashboard from "@/pages/Dashboard";
import MenuManagement from "@/pages/MenuManagement";
import ModifierManagement from "@/pages/ModifierManagement";
import RestaurantSetup from "@/pages/RestaurantSetup";
import ItemVisibility from "@/pages/ItemVisibility";
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
}

export const ProfileContext = createContext<ProfileContextType>({
  profile: "",
  profileData: null,
  setProfile: () => {},
  setProfileData: () => {},
});

export const useProfile = () => useContext(ProfileContext);

function App() {
  const { currentUser, isLoading } = useFrappeAuth();
  const [profile, setProfile] = useState("");
  const [profileData, setProfileData] = useState<any>(null);

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

  return (
    <ProfileContext.Provider value={{ profile, profileData, setProfile, setProfileData }}>
      <BrowserRouter basename="/pos">
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/menu" element={<MenuManagement />} />
            <Route path="/modifiers" element={<ModifierManagement />} />
            <Route path="/restaurant" element={<RestaurantSetup />} />
            <Route path="/visibility" element={<ItemVisibility />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </ProfileContext.Provider>
  );
}

export default App;
