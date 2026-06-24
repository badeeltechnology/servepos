import { useState, useCallback } from "react";
import { useFrappeGetDoc, useFrappeAuth, useFrappeGetDocList, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {
  ArrowLeft,
  User,
  Settings as SettingsIcon,
  LogOut,
  LayoutGrid,
  ChefHat,
  Receipt,
  Wallet,
  Clock,
  Sun,
  Moon,
  ExternalLink,
  Building,
  CreditCard,
  Bell,
  CheckCircle,
  XCircle,
  Upload,
  Trash2,
  Zap,
} from "lucide-react";

export default function SettingsPage() {
  const { theme, toggleTheme, setTheme } = useTheme();
  const { currentUser, logout } = useFrappeAuth();

  // Fetch user details
  const { data: user, isLoading } = useFrappeGetDoc("User", currentUser || "", {
    fields: ["full_name", "email", "user_image"],
  });

  // Fetch POS Profile
  const { data: posProfiles } = useFrappeGetDocList("POS Profile", {
    fields: ["name", "company", "warehouse"],
    filters: [["disabled", "=", 0]],
    limit: 1,
  });

  // Fetch POS Opening Entry
  const { data: openingEntries } = useFrappeGetDocList("POS Opening Entry", {
    fields: ["name", "pos_profile", "status", "creation"],
    filters: [
      ["user", "=", currentUser || "Administrator"],
      ["status", "=", "Open"],
      ["docstatus", "=", 1],
    ],
    limit: 1,
  });

  // Theme classes
  const bgMain = theme === "dark" ? "bg-zinc-950" : "bg-gray-100";
  const bgCard = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const bgButton = theme === "dark" ? "bg-zinc-800" : "bg-gray-200";
  const bgButtonHover = theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";
  const borderColor = theme === "dark" ? "border-zinc-800" : "border-gray-200";
  const textMain = theme === "dark" ? "text-white" : "text-gray-900";
  const textMuted = theme === "dark" ? "text-zinc-400" : "text-gray-500";

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  const handleCloseShift = () => {
    if (openingEntries?.length) {
      window.location.href = `/app/pos-closing-entry/new?pos_opening_entry=${openingEntries[0].name}`;
    }
  };

  if (isLoading) {
    return (
      <div className={cn("flex h-screen items-center justify-center", bgMain)}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const quickLinks = [
    {
      title: "POS Profile",
      description: "Configure POS settings",
      icon: <SettingsIcon className="h-5 w-5" />,
      href: "/app/pos-profile",
      color: "text-blue-500",
    },
    {
      title: "Rooms",
      description: "Manage dining areas",
      icon: <Building className="h-5 w-5" />,
      href: "/app/servepos-room",
      color: "text-green-500",
    },
    {
      title: "Tables",
      description: "Manage restaurant tables",
      icon: <LayoutGrid className="h-5 w-5" />,
      href: "/app/servepos-table",
      color: "text-purple-500",
    },
    {
      title: "Menu Items",
      description: "Manage menu items",
      icon: <ChefHat className="h-5 w-5" />,
      href: "/app/item?item_group=Menu%20Items",
      color: "text-orange-500",
    },
    {
      title: "POS Invoices",
      description: "View all POS invoices",
      icon: <Receipt className="h-5 w-5" />,
      href: "/app/pos-invoice",
      color: "text-cyan-500",
    },
    {
      title: "Payment Methods",
      description: "Configure payment modes",
      icon: <CreditCard className="h-5 w-5" />,
      href: "/app/mode-of-payment",
      color: "text-pink-500",
    },
  ];

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
              <SettingsIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Settings</h1>
              <p className={cn("text-xs", textMuted)}>ServePOS Configuration</p>
            </div>
          </div>
        </div>

        <button
          onClick={toggleTheme}
          className={cn("flex h-9 w-9 items-center justify-center rounded-lg", bgButton, bgButtonHover)}
        >
          {theme === "dark" ? <Sun className="h-4 w-4 text-yellow-500" /> : <Moon className="h-4 w-4 text-blue-600" />}
        </button>
      </header>

      {/* Settings Content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* User Profile Section */}
          <section className={cn("rounded-xl border p-6", borderColor, bgCard)}>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <User className="h-5 w-5 text-orange-500" />
              User Profile
            </h2>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500 text-2xl font-bold text-white">
                  {user?.full_name?.charAt(0) || "U"}
                </div>
                <div>
                  <p className="text-lg font-medium">{user?.full_name}</p>
                  <p className={cn("text-sm", textMuted)}>{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </section>

          {/* Current Session */}
          <section className={cn("rounded-xl border p-6", borderColor, bgCard)}>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-5 w-5 text-orange-500" />
              Current Session
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className={cn("rounded-lg p-4", bgButton)}>
                <p className={cn("text-sm", textMuted)}>POS Profile</p>
                <p className="text-lg font-medium">{posProfiles?.[0]?.name || "Not configured"}</p>
              </div>
              <div className={cn("rounded-lg p-4", bgButton)}>
                <p className={cn("text-sm", textMuted)}>Session Status</p>
                <p className="text-lg font-medium">
                  {openingEntries?.length ? (
                    <span className="text-green-500">Open</span>
                  ) : (
                    <span className="text-red-500">Closed</span>
                  )}
                </p>
              </div>
            </div>
            {(openingEntries?.length ?? 0) > 0 && (
              <button
                onClick={handleCloseShift}
                className={cn(
                  "mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium",
                  "bg-orange-500 text-white hover:bg-orange-600"
                )}
              >
                <Wallet className="h-4 w-4" />
                Close Shift & Settle
              </button>
            )}
          </section>

          {/* Theme Settings */}
          <section className={cn("rounded-xl border p-6", borderColor, bgCard)}>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Sun className="h-5 w-5 text-orange-500" />
              Appearance
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setTheme("dark")}
                className={cn(
                  "flex items-center justify-center gap-3 rounded-lg border-2 p-4 transition-all",
                  theme === "dark"
                    ? "border-orange-500 bg-orange-500/10"
                    : cn("border-transparent", bgButton, bgButtonHover)
                )}
              >
                <Moon className="h-6 w-6" />
                <div className="text-left">
                  <p className="font-medium">Dark Mode</p>
                  <p className={cn("text-xs", textMuted)}>Easy on the eyes</p>
                </div>
              </button>
              <button
                onClick={() => setTheme("light")}
                className={cn(
                  "flex items-center justify-center gap-3 rounded-lg border-2 p-4 transition-all",
                  theme === "light"
                    ? "border-orange-500 bg-orange-500/10"
                    : cn("border-transparent", bgButton, bgButtonHover)
                )}
              >
                <Sun className="h-6 w-6" />
                <div className="text-left">
                  <p className="font-medium">Light Mode</p>
                  <p className={cn("text-xs", textMuted)}>Classic look</p>
                </div>
              </button>
            </div>
          </section>

          {/* Quick Links */}
          <section className={cn("rounded-xl border p-6", borderColor, bgCard)}>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <ExternalLink className="h-5 w-5 text-orange-500" />
              Quick Links
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {quickLinks.map((link) => (
                <a
                  key={link.title}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg p-4 transition-all",
                    bgButton,
                    bgButtonHover
                  )}
                >
                  <div className={link.color}>{link.icon}</div>
                  <div>
                    <p className="font-medium">{link.title}</p>
                    <p className={cn("text-xs", textMuted)}>{link.description}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>

          {/* FCM / Push Notifications */}
          <FCMSettings theme={theme} bgCard={bgCard} bgButton={bgButton} bgButtonHover={bgButtonHover} borderColor={borderColor} textMuted={textMuted} />

          {/* App Info */}
          <section className={cn("rounded-xl border p-6", borderColor, bgCard)}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">ServePOS</h3>
                <p className={cn("text-sm", textMuted)}>Restaurant Point of Sale System</p>
              </div>
              <div className="text-right">
                <p className={cn("text-sm", textMuted)}>Version 1.0.0</p>
                <p className={cn("text-xs", textMuted)}>Built with Frappe + React</p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function FCMSettings({
  theme,
  bgCard,
  bgButton,
  bgButtonHover,
  borderColor,
  textMuted,
}: {
  theme: string;
  bgCard: string;
  bgButton: string;
  bgButtonHover: string;
  borderColor: string;
  textMuted: string;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const { data: fcmStatus, mutate: refreshStatus } = useFrappeGetCall<{
    message: {
      configured: boolean;
      project_id: string;
      source: string;
      google_auth_installed: boolean;
    };
  }>("servepos.api.settings.get_fcm_status");

  const { call: saveCreds } = useFrappePostCall("servepos.api.settings.save_fcm_credentials");
  const { call: removeCreds } = useFrappePostCall("servepos.api.settings.remove_fcm_credentials");
  const { call: testConnection } = useFrappePostCall("servepos.api.settings.test_fcm_connection");

  const status = fcmStatus?.message;

  const handleSave = useCallback(async () => {
    if (!jsonInput.trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      await saveCreds({ credentials_json: jsonInput.trim() });
      setJsonInput("");
      setShowUpload(false);
      refreshStatus();
    } catch (e: any) {
      alert(e?.message || "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  }, [jsonInput, saveCreds, refreshStatus]);

  const handleRemove = useCallback(async () => {
    if (!confirm("Remove FCM credentials? Push notifications will stop working.")) return;
    try {
      await removeCreds({});
      refreshStatus();
      setTestResult(null);
    } catch (e: any) {
      alert(e?.message || "Failed to remove");
    }
  }, [removeCreds, refreshStatus]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection({});
      setTestResult(res as any);
    } catch (e: any) {
      setTestResult({ success: false, error: e?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  }, [testConnection]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonInput(ev.target?.result as string || "");
    };
    reader.readAsText(file);
  }, []);

  return (
    <section className={cn("rounded-xl border p-6", borderColor, bgCard)}>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Bell className="h-5 w-5 text-orange-500" />
        Push Notifications (FCM)
      </h2>

      {/* Status */}
      <div className={cn("rounded-lg p-4 mb-4", bgButton)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status?.configured ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-400" />
            )}
            <div>
              <p className="font-medium">
                {status?.configured ? "FCM Configured" : "FCM Not Configured"}
              </p>
              {status?.configured && status.project_id && (
                <p className={cn("text-sm", textMuted)}>
                  Project: {status.project_id}
                </p>
              )}
              {!status?.google_auth_installed && (
                <p className="text-sm text-red-400">
                  google-auth package not installed (pip install google-auth)
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status?.configured && (
              <>
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                    bgButtonHover,
                    "border",
                    borderColor
                  )}
                >
                  {testing ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  Test
                </button>
                <button
                  onClick={handleRemove}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {testResult && (
          <div
            className={cn(
              "mt-3 rounded-lg px-3 py-2 text-sm",
              testResult.success
                ? "bg-green-500/10 text-green-500"
                : "bg-red-500/10 text-red-400"
            )}
          >
            {testResult.success
              ? `Connection successful! Project: ${(testResult as any).project_id}`
              : `Failed: ${testResult.error}`}
          </div>
        )}
      </div>

      {/* Upload / Configure */}
      {!showUpload ? (
        <button
          onClick={() => setShowUpload(true)}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed py-4 text-sm font-medium transition-colors",
            borderColor,
            bgButtonHover,
            textMuted
          )}
        >
          <Upload className="h-4 w-4" />
          {status?.configured ? "Update Firebase Credentials" : "Add Firebase Service Account JSON"}
        </button>
      ) : (
        <div className={cn("rounded-lg border p-4", borderColor)}>
          <p className={cn("text-sm mb-3", textMuted)}>
            Paste your Firebase service account JSON or upload the file.
            Get it from: Firebase Console → Project Settings → Service Accounts → Generate new private key.
          </p>

          {/* File upload */}
          <label
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 mb-3 cursor-pointer text-sm font-medium",
              borderColor,
              bgButtonHover,
              textMuted
            )}
          >
            <Upload className="h-4 w-4" />
            Upload JSON file
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {/* Or paste */}
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder='{"type": "service_account", "project_id": "...", ...}'
            rows={6}
            className={cn(
              "w-full rounded-lg border px-3 py-2 text-sm font-mono",
              borderColor,
              "focus:outline-none focus:border-orange-500",
              theme === "dark" ? "bg-zinc-800 text-white" : "bg-white"
            )}
          />

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                setShowUpload(false);
                setJsonInput("");
              }}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium",
                bgButton,
                bgButtonHover
              )}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !jsonInput.trim()}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Credentials"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
