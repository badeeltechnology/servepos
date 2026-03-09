import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useFrappeAuth } from "frappe-react-sdk";

// Pages
import POSPage from "@/pages/POS";
import KDSPage from "@/pages/KDS";
import TablesPage from "@/pages/Tables";
import SettingsPage from "@/pages/Settings";

// Context
import { ThemeProvider } from "@/contexts/ThemeContext";

// Components
import { Toaster } from "@/components/ui/toaster";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

function App() {
  const { currentUser, isLoading } = useFrappeAuth();

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!currentUser || currentUser === "Guest") {
    window.location.href = "/login?redirect-to=/pos";
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <ThemeProvider>
      <BrowserRouter basename="/pos">
        <Routes>
          <Route path="/" element={<POSPage />} />
          <Route path="/kds" element={<KDSPage />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
