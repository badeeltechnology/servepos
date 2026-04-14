import { useState, useEffect } from "react";
import { useFrappeGetDocList, useFrappePostCall, useFrappeGetCall } from "frappe-react-sdk";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn, formatCurrency } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Users,
  UtensilsCrossed,
  Coffee,
  Cake,
  ChefHat,
  LayoutGrid,
  Sun,
  Moon,
  X,
  CreditCard,
  Banknote,
  Smartphone,
  Check,
  Clock,
  Receipt,
  RefreshCw,
  Printer,
  History,
  Eye,
  LogOut,
  RotateCcw,
  Ban,
  Store,
  ClipboardList,
} from "lucide-react";

interface Modifier {
  name: string;
  price: number;
}

interface CartItem {
  id: string;
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  modifiers: Modifier[];
  variant?: string;
  comment?: string;
}

interface MenuItem {
  name: string;
  item_name: string;
  item_group: string;
  standard_rate: number;
  servepos_modifiers?: string;
  servepos_kitchen_station?: string;
  has_variants?: number;
  variant_of?: string;
}

interface ItemVariant {
  name: string;
  item_name: string;
  standard_rate: number;
  variant_of: string;
}

interface PaymentEntry {
  mode: string;
  amount: number;
}

const categoryIcons: Record<string, React.ReactNode> = {
  "Main Course": <UtensilsCrossed className="h-4 w-4" />,
  Beverages: <Coffee className="h-4 w-4" />,
  Starters: <ChefHat className="h-4 w-4" />,
  Desserts: <Cake className="h-4 w-4" />,
};

const paymentIcons: Record<string, React.ReactNode> = {
  "Cash": <Banknote className="h-5 w-5" />,
  "Card": <CreditCard className="h-5 w-5" />,
  "Credit Card": <CreditCard className="h-5 w-5" />,
  "Debit Card": <CreditCard className="h-5 w-5" />,
  "Mobile Payment": <Smartphone className="h-5 w-5" />,
};

interface ModifierGroup {
  group_name: string;
  selection_type: "Single" | "Multiple";
  is_required: number;
  max_selections: number;
  modifiers: Modifier[];
}

type OrderType = "Dine In" | "Takeaway" | "Delivery";

interface POSProfile {
  name: string;
  company: string;
  warehouse: string;
  customer: string;
  currency: string;
  selling_price_list: string;
  has_open_session?: boolean;
  open_session?: { name: string; period_start_date: string };
}

interface OpeningEntry {
  name: string;
  pos_profile: string;
  company: string;
  period_start_date: string;
  posting_date: string;
}

interface PaymentMethod {
  mode_of_payment: string;
  opening_amount: number;
}

interface SessionDetails {
  opening_entry: string;
  invoice_count: number;
  total_sales: number;
  total_tax: number;
  net_total: number;
  payment_breakdown: Record<string, number>;
  opening_balances: Record<string, number>;
}

interface ReconciliationEntry {
  mode_of_payment: string;
  opening_amount: number;
  sales_amount: number;
  expected_amount: number;
  closing_amount: number;
}

export default function POSPage() {
  const { theme, toggleTheme } = useTheme();
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState(2);
  const [orderType, setOrderType] = useState<OrderType>("Dine In");

  // Profile selection state
  const [selectedProfile, setSelectedProfile] = useState<POSProfile | null>(null);
  const [showProfileSelector, setShowProfileSelector] = useState(false);

  // Session/Opening entry state
  const [hasOpeningEntry, setHasOpeningEntry] = useState<boolean | null>(null);
  const [currentOpeningEntry, setCurrentOpeningEntry] = useState<OpeningEntry | null>(null);
  const [showOpeningDialog, setShowOpeningDialog] = useState(false);
  const [openingBalances, setOpeningBalances] = useState<PaymentMethod[]>([]);

  // Closing entry state
  const [_showClosingDialog, setShowClosingDialog] = useState(false);
  const [_sessionDetails, setSessionDetails] = useState<SessionDetails | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationEntry[]>([]);

  // Void/Cancel state
  const [_showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidOrder, setVoidOrder] = useState<{ name: string; grand_total: number } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // Return state
  const [_showReturnDialog, setShowReturnDialog] = useState(false);
  const [returnOrder, setReturnOrder] = useState<{ name: string; grand_total: number; items: any[] } | null>(null);

  // Modifier dialog state
  const [showModifierDialog, setShowModifierDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<Modifier[]>([]);
  const [itemComment, setItemComment] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<ItemVariant | null>(null);
  const [itemModifierGroups, setItemModifierGroups] = useState<ModifierGroup[]>([]);
  const [loadingModifiers, setLoadingModifiers] = useState(false);

  // Payment dialog state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);

  // Order status
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successOrder, setSuccessOrder] = useState<{ name: string; total: number } | null>(null);

  // History state
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // Invoice summary state
  const [showInvoiceSummary, setShowInvoiceSummary] = useState(false);
  const [invoiceSummaryData, setInvoiceSummaryData] = useState<any[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Invoice type from POS Settings (POS Invoice or Sales Invoice)
  const [invoiceType, setInvoiceType] = useState<"POS Invoice" | "Sales Invoice">("POS Invoice");

  // Fetch POS Settings for invoice type
  const { data: posSettings } = useFrappeGetCall<{ message: { invoice_type: string } }>(
    "servepos.api.pos_session.get_pos_settings"
  );

  // Update invoice type when POS Settings loads
  useEffect(() => {
    const type = posSettings?.message?.invoice_type;
    if (type === "Sales Invoice" || type === "POS Invoice") {
      setInvoiceType(type);
    }
  }, [posSettings]);

  // Fetch available POS Profiles with session status
  const { data: posProfilesData, isLoading: profileLoading, mutate: refreshProfiles } = useFrappeGetCall<{ message: POSProfile[] }>(
    "servepos.api.pos_session.get_pos_profiles_for_user"
  );

  const posProfiles = posProfilesData?.message || [];

  // API calls
  const { call: createOpening } = useFrappePostCall("servepos.api.pos_session.create_opening_entry");
  const { call: _getSessionDetails } = useFrappePostCall("servepos.api.pos_session.get_session_details");
  const { call: createClosing } = useFrappePostCall("servepos.api.pos_session.create_closing_entry");
  const { call: getClosingPreview } = useFrappePostCall("servepos.api.pos_session.get_closing_summary_preview");
  const { call: voidInvoice } = useFrappePostCall("servepos.api.pos_session.void_invoice");
  const { call: createReturn } = useFrappePostCall("servepos.api.pos_session.create_return_invoice");
  const { call: getPaymentMethods } = useFrappePostCall("servepos.api.pos_session.get_payment_methods");
  const { call: getInvoiceSummary } = useFrappePostCall("servepos.api.pos_session.get_invoice_summary");

  const openInvoiceSummary = async () => {
    setShowInvoiceSummary(true);
    setLoadingSummary(true);
    try {
      const res = await getInvoiceSummary({
        pos_profile: selectedProfile?.name || "",
      });
      setInvoiceSummaryData(res?.message || []);
    } catch {
      setInvoiceSummaryData([]);
    } finally {
      setLoadingSummary(false);
    }
  };

  // Fetch POS Profile payments
  const { data: posProfilePayments } = useFrappeGetDocList(
    "POS Payment Method",
    {
      fields: ["mode_of_payment", "default"],
      filters: selectedProfile ? [["parent", "=", selectedProfile.name]] : [],
      limit: 10,
    }
  );

  // Item Groups — via centralized registry (filtered by selected POS profile)
  const { data: registryItemGroupsResp } = useFrappeGetCall<{ message: any[] }>(
    "servepos.api.registry.get_item_groups",
    selectedProfile ? { pos_profile: selectedProfile.name } : undefined,
    selectedProfile ? undefined : null,
  );
  const itemGroups = registryItemGroupsResp?.message || [];

  // Menu Items — via centralized registry
  const { data: registryItemsResp, isLoading: itemsLoading } = useFrappeGetCall<{ message: MenuItem[] }>(
    "servepos.api.registry.get_items",
    selectedProfile ? { pos_profile: selectedProfile.name } : undefined,
    selectedProfile ? undefined : null,
  );
  const menuItems = (registryItemsResp?.message || []).filter((i: any) => !i.variant_of);

  // Fetch Variants
  const { data: itemVariants } = useFrappeGetDocList<ItemVariant>(
    "Item",
    {
      fields: ["name", "item_name", "standard_rate", "variant_of"],
      filters: selectedItem?.has_variants
        ? [["variant_of", "=", selectedItem.name]]
        : [["name", "=", ""]],
      limit: 50,
    }
  );

  // Tables — via centralized registry (filtered by selected POS profile)
  const { data: registryTablesResp, mutate: refreshTables } = useFrappeGetCall<{ message: any[] }>(
    "servepos.api.registry.get_tables",
    selectedProfile ? { pos_profile: selectedProfile.name } : undefined,
    selectedProfile ? undefined : null,
  );
  const tables = (registryTablesResp?.message || []).filter((t: any) => t.status === "Available" || !t.status);

  // Fetch Order History (today's orders) - use invoiceType
  const { data: orderHistory, mutate: refreshHistory } = useFrappeGetDocList(
    invoiceType,
    {
      fields: ["name", "posting_date", "posting_time", "grand_total", "status", "customer_name", "servepos_table", "servepos_order_type", "docstatus"],
      filters: selectedProfile ? (
        invoiceType === "Sales Invoice"
          ? [["pos_profile", "=", selectedProfile.name], ["is_pos", "=", 1]]
          : [["pos_profile", "=", selectedProfile.name]]
      ) : [],
      orderBy: { field: "creation", order: "desc" },
      limit: 50,
    }
  );

  // Initialize profile and session on load
  useEffect(() => {
    if (posProfiles.length > 0 && !selectedProfile) {
      // Check if any profile has an open session
      const profileWithSession = posProfiles.find(p => p.has_open_session);
      if (profileWithSession) {
        setSelectedProfile(profileWithSession);
        setHasOpeningEntry(true);
        if (profileWithSession.open_session) {
          setCurrentOpeningEntry({
            name: profileWithSession.open_session.name,
            pos_profile: profileWithSession.name,
            company: profileWithSession.company,
            period_start_date: profileWithSession.open_session.period_start_date,
            posting_date: new Date().toISOString().split('T')[0],
          });
        }
      } else if (posProfiles.length === 1) {
        // Single profile without session - auto-select and show opening dialog
        setSelectedProfile(posProfiles[0]);
        setHasOpeningEntry(false);
        initializeOpeningBalances(posProfiles[0].name);
        setShowOpeningDialog(true);
      } else {
        // Multiple profiles - show profile selector
        setShowProfileSelector(true);
      }
    }
  }, [posProfiles]);

  // Initialize opening balances for a profile
  const initializeOpeningBalances = async (profileName: string) => {
    try {
      const result = await getPaymentMethods({ pos_profile: profileName });
      if (result.message) {
        setOpeningBalances(result.message.map((p: any) => ({
          mode_of_payment: p.mode_of_payment,
          opening_amount: 0
        })));
      }
    } catch (error) {
      console.error("Error getting payment methods:", error);
      setOpeningBalances([{ mode_of_payment: "Cash", opening_amount: 0 }]);
    }
  };

  const categories = ["All", ...(itemGroups?.map((g) => g.name) || [])];

  // Ensure paymentModes always has valid values
  const paymentModes = (() => {
    const modes = posProfilePayments?.map((p) => p.mode_of_payment).filter(Boolean) || [];
    return modes.length > 0 ? modes : ["Cash"];
  })();

  const filteredItems = menuItems?.filter((item) => {
    const matchesCategory =
      selectedCategory === "All" || item.item_group === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      item.item_name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleItemClick = async (item: MenuItem) => {
    // Fetch modifiers for this item
    setLoadingModifiers(true);
    try {
      const response = await fetch(
        `/api/method/servepos.api.pos_session.get_item_modifiers?item_code=${encodeURIComponent(item.name)}`,
        {
          headers: { "X-Frappe-CSRF-Token": window.csrf_token || "" },
        }
      );
      const data = await response.json();
      const modifierGroups: ModifierGroup[] = data.message || [];
      setItemModifierGroups(modifierGroups);

      // Show dialog if item has variants or modifiers
      if (item.has_variants || modifierGroups.length > 0) {
        setSelectedItem(item);
        setSelectedModifiers([]);
        setItemComment("");
        setSelectedVariant(null);
        setShowModifierDialog(true);
      } else {
        addToCartDirect(item);
      }
    } catch {
      // If fetch fails, fall back to direct add
      addToCartDirect(item);
    } finally {
      setLoadingModifiers(false);
    }
  };

  const addToCartDirect = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find(
        (c) => c.item_code === item.name && c.modifiers.length === 0 && !c.variant
      );
      if (existing) {
        return prev.map((c) =>
          c.id === existing.id
            ? { ...c, qty: c.qty + 1, amount: (c.qty + 1) * c.rate }
            : c
        );
      }
      return [
        ...prev,
        {
          id: `${item.name}-${Date.now()}`,
          item_code: item.name,
          item_name: item.item_name,
          qty: 1,
          rate: item.standard_rate,
          amount: item.standard_rate,
          modifiers: [],
        },
      ];
    });
  };

  const addToCartWithModifiers = () => {
    if (!selectedItem) return;

    const finalItem = selectedVariant || selectedItem;
    const modifierTotal = selectedModifiers.reduce((sum, m) => sum + m.price, 0);
    const finalRate = finalItem.standard_rate + modifierTotal;

    setCart((prev) => [
      ...prev,
      {
        id: `${finalItem.name}-${Date.now()}`,
        item_code: finalItem.name,
        item_name: finalItem.item_name,
        qty: 1,
        rate: finalRate,
        amount: finalRate,
        modifiers: selectedModifiers,
        variant: selectedVariant?.name,
        comment: itemComment || undefined,
      },
    ]);

    setShowModifierDialog(false);
    setSelectedItem(null);
    setSelectedModifiers([]);
    setItemComment("");
    setSelectedVariant(null);
  };

  const toggleModifier = (modifier: Modifier) => {
    setSelectedModifiers((prev) =>
      prev.find((m) => m.name === modifier.name)
        ? prev.filter((m) => m.name !== modifier.name)
        : [...prev, modifier]
    );
  };

  const updateQty = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.id === itemId
            ? { ...c, qty: c.qty + delta, amount: (c.qty + delta) * c.rate }
            : c
        )
        .filter((c) => c.qty > 0)
    );
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((c) => c.id !== itemId));
  };

  const clearCart = () => setCart([]);

  const subtotal = cart.reduce((sum, item) => sum + item.amount, 0);
  const total = subtotal;
  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = total - paidAmount;

  // Select a POS Profile
  const selectProfile = async (profile: POSProfile) => {
    setSelectedProfile(profile);
    setShowProfileSelector(false);

    if (profile.has_open_session && profile.open_session) {
      setHasOpeningEntry(true);
      setCurrentOpeningEntry({
        name: profile.open_session.name,
        pos_profile: profile.name,
        company: profile.company,
        period_start_date: profile.open_session.period_start_date,
        posting_date: new Date().toISOString().split('T')[0],
      });
    } else {
      setHasOpeningEntry(false);
      await initializeOpeningBalances(profile.name);
      setShowOpeningDialog(true);
    }
  };

  // Create Opening Entry
  const handleCreateOpeningEntry = async () => {
    if (!selectedProfile) return;

    try {
      const result = await createOpening({
        pos_profile: selectedProfile.name,
        company: selectedProfile.company,
        balance_details: openingBalances
      });

      if (result.message) {
        setCurrentOpeningEntry({
          name: result.message.name,
          pos_profile: result.message.pos_profile,
          company: result.message.company,
          period_start_date: result.message.period_start_date,
          posting_date: new Date().toISOString().split('T')[0],
        });
        setHasOpeningEntry(true);
        setShowOpeningDialog(false);
        refreshProfiles();
      }
    } catch (error) {
      console.error("Error creating opening entry:", error);
      alert("Failed to create opening entry: " + (error as Error).message);
    }
  };

  // Open closing dialog
  const openClosingDialog = async () => {
    if (!currentOpeningEntry) return;

    try {
      const result = await getClosingPreview({ pos_opening_entry: currentOpeningEntry.name });
      if (result.message) {
        setSessionDetails(result.message.session);
        setReconciliation(result.message.reconciliation);
        setShowClosingDialog(true);
      }
    } catch (error) {
      console.error("Error getting closing preview:", error);
      alert("Failed to get session details");
    }
  };

  // Create Closing Entry
  const _handleCreateClosingEntry = async () => {
    if (!currentOpeningEntry) return;

    try {
      const result = await createClosing({
        pos_opening_entry: currentOpeningEntry.name,
        payment_reconciliation: reconciliation.map(r => ({
          mode_of_payment: r.mode_of_payment,
          opening_amount: r.opening_amount,
          expected_amount: r.expected_amount,
          closing_amount: r.closing_amount
        }))
      });

      if (result.message) {
        alert(`Session closed successfully!\nClosing Entry: ${result.message.name}\nTotal Sales: ${formatCurrency(result.message.grand_total)}\nInvoices: ${result.message.invoice_count}`);
        setShowClosingDialog(false);
        setHasOpeningEntry(false);
        setCurrentOpeningEntry(null);
        setSelectedProfile(null);
        refreshProfiles();
      }
    } catch (error) {
      console.error("Error creating closing entry:", error);
      alert("Failed to close session: " + (error as Error).message);
    }
  };

  // Void/Cancel order
  const _handleVoidOrder = async () => {
    if (!voidOrder || !voidReason.trim()) {
      alert("Please provide a reason for voiding the order");
      return;
    }

    try {
      const result = await voidInvoice({
        invoice_name: voidOrder.name,
        reason: voidReason
      });

      if (result.message) {
        alert("Order voided successfully");
        setShowVoidDialog(false);
        setVoidOrder(null);
        setVoidReason("");
        refreshHistory();
      }
    } catch (error) {
      console.error("Error voiding order:", error);
      alert("Failed to void order: " + (error as Error).message);
    }
  };

  // Open return dialog
  const openReturnDialog = async (order: { name: string; grand_total: number }) => {
    try {
      // Fetch order items
      const response = await fetch(`/api/resource/${encodeURIComponent(invoiceType)}/${order.name}?fields=["items"]`);
      const data = await response.json();

      if (data.data?.items) {
        setReturnOrder({
          ...order,
          items: data.data.items.map((item: any) => ({
            ...item,
            return_qty: item.qty
          }))
        });
        setShowReturnDialog(true);
      }
    } catch (error) {
      console.error("Error fetching order items:", error);
      alert("Failed to fetch order items");
    }
  };

  // Create return invoice
  const _handleCreateReturn = async () => {
    if (!returnOrder) return;

    try {
      const itemsToReturn = returnOrder.items
        .filter((item: any) => item.return_qty > 0)
        .map((item: any) => ({
          item_code: item.item_code,
          qty: item.return_qty,
          rate: item.rate
        }));

      if (itemsToReturn.length === 0) {
        alert("Please select items to return");
        return;
      }

      const result = await createReturn({
        original_invoice: returnOrder.name,
        items_to_return: itemsToReturn
      });

      if (result.message) {
        alert(`Return invoice created: ${result.message.name}\nRefund Amount: ${formatCurrency(Math.abs(result.message.grand_total))}`);
        setShowReturnDialog(false);
        setReturnOrder(null);
        refreshHistory();
      }
    } catch (error) {
      console.error("Error creating return:", error);
      alert("Failed to create return: " + (error as Error).message);
    }
  };

  // Open payment dialog
  const openPaymentDialog = () => {
    if (cart.length === 0) return;
    setPayments([]);
    setShowPaymentDialog(true);
  };

  // Add payment
  const addPayment = (mode: string, amount: number) => {
    if (amount <= 0) return;
    setPayments((prev) => {
      const existing = prev.find((p) => p.mode === mode);
      if (existing) {
        return prev.map((p) =>
          p.mode === mode ? { ...p, amount: p.amount + amount } : p
        );
      }
      return [...prev, { mode, amount }];
    });
  };

  // Submit order
  const submitOrder = async () => {
    if (!selectedProfile || cart.length === 0) return;
    if (paidAmount < total) {
      alert("Payment amount is less than total!");
      return;
    }

    setIsSubmitting(true);

    try {
      const items = cart.map((item) => ({
        item_code: item.item_code,
        qty: item.qty,
        rate: item.rate,
      }));

      const paymentEntries = payments.map((p) => ({
        mode_of_payment: p.mode || "Cash",
        amount: p.amount,
      }));

      // Get current date/time
      const now = new Date();
      const postingDate = now.toISOString().split('T')[0];
      const postingTime = now.toTimeString().split(' ')[0];

      const invoiceData: Record<string, any> = {
        doctype: invoiceType,
        customer: selectedProfile.customer || "Walk-in Customer",
        company: selectedProfile.company,
        pos_profile: selectedProfile.name,
        is_pos: 1,
        posting_date: postingDate,
        posting_time: postingTime,
        set_warehouse: selectedProfile.warehouse,
        currency: selectedProfile.currency || "QAR",
        selling_price_list: selectedProfile.selling_price_list || "Standard Selling",
        servepos_table: selectedTable || "",
        servepos_order_type: orderType,
        servepos_guests: guestCount,
        items,
        payments: paymentEntries,
      };

      // Add Sales Invoice specific fields
      if (invoiceType === "Sales Invoice") {
        invoiceData.update_stock = 1;
        invoiceData.is_created_using_pos = 1;
      }

      // Use frappe.client.insert method
      const response = await fetch("/api/method/frappe.client.insert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": window.csrf_token || "",
        },
        body: JSON.stringify({ doc: invoiceData }),
      });

      const responseData = await response.json();

      if (response.ok && responseData.message) {
        const createdDoc = responseData.message;
        const invoiceName = createdDoc.name;

        // Submit the invoice using the full document from insert
        const submitResponse = await fetch("/api/method/frappe.client.submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token": window.csrf_token || "",
          },
          body: JSON.stringify({ doc: createdDoc }),
        });

        const submitData = await submitResponse.json();

        if (submitResponse.ok && submitData.message) {
          setCart([]);
          setPayments([]);
          setSelectedTable(null);
          setShowPaymentDialog(false);
          refreshTables();
          setSuccessOrder({ name: invoiceName, total: total });
        } else {
          console.error("Submit error:", submitData);
          alert(`Order created (${invoiceName}) but could not submit: ${submitData.exc || submitData.message || JSON.stringify(submitData._server_messages) || "Unknown error"}`);
        }
      } else {
        console.error("Create error:", responseData);
        const serverMessages = responseData._server_messages ? JSON.parse(responseData._server_messages) : null;
        const errorMsg = serverMessages ? JSON.parse(serverMessages[0])?.message : (responseData.exc || responseData.message || "Failed to create order");
        alert(`Error: ${errorMsg}`);
      }
    } catch (error) {
      console.error("Error submitting order:", error);
      alert(`Failed to submit order: ${error}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Theme classes
  const bgMain = theme === "dark" ? "bg-zinc-950" : "bg-gray-100";
  const bgCard = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const bgCardHover = theme === "dark" ? "hover:bg-zinc-800" : "hover:bg-gray-50";
  const bgInput = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const bgButton = theme === "dark" ? "bg-zinc-800" : "bg-gray-200";
  const bgButtonHover = theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";
  const borderColor = theme === "dark" ? "border-zinc-800" : "border-gray-200";
  const textMain = theme === "dark" ? "text-white" : "text-gray-900";
  const textMuted = theme === "dark" ? "text-zinc-400" : "text-gray-500";
  const textMuted2 = theme === "dark" ? "text-zinc-500" : "text-gray-400";

  if (profileLoading) {
    return (
      <div className={cn("flex h-screen items-center justify-center", bgMain)}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (posProfiles.length === 0) {
    return (
      <div className={cn("flex h-screen flex-col items-center justify-center gap-4", bgMain, textMain)}>
        <h1 className="text-2xl font-bold">No POS Profile Found</h1>
        <p className={textMuted}>Please configure a POS Profile in ERPNext to continue.</p>
        <a
          href="/app/pos-profile"
          className="rounded-lg bg-orange-500 px-6 py-2 font-medium text-white hover:bg-orange-600"
        >
          Configure POS Profile
        </a>
      </div>
    );
  }

  // Profile Selection Screen
  if (showProfileSelector) {
    return (
      <div className={cn("flex h-screen items-center justify-center", bgMain)}>
        <div className={cn("w-full max-w-lg rounded-2xl p-6", bgCard, textMain)}>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 text-white">
              <Store className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Select POS Profile</h2>
              <p className={cn("text-sm", textMuted)}>Choose a profile to start your session</p>
            </div>
          </div>

          <div className="space-y-3">
            {posProfiles.map((profile) => (
              <button
                key={profile.name}
                onClick={() => selectProfile(profile)}
                className={cn(
                  "w-full rounded-xl p-4 text-left transition-all hover:ring-2 hover:ring-orange-500",
                  bgButton, bgButtonHover
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{profile.name}</h3>
                    <p className={cn("text-sm", textMuted)}>{profile.company}</p>
                  </div>
                  {profile.has_open_session && (
                    <span className="rounded-full bg-green-500/20 text-green-500 px-3 py-1 text-xs font-medium">
                      Session Active
                    </span>
                  )}
                </div>
                <div className={cn("flex gap-4 mt-2 text-xs", textMuted2)}>
                  <span>Warehouse: {profile.warehouse}</span>
                  <span>Currency: {profile.currency || "Default"}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Opening Entry Dialog
  if (showOpeningDialog && !hasOpeningEntry && selectedProfile) {
    return (
      <div className={cn("flex h-screen items-center justify-center", bgMain)}>
        <div className={cn("w-full max-w-md rounded-2xl p-6", bgCard, textMain)}>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 text-white">
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Start POS Session</h2>
              <p className={cn("text-sm", textMuted)}>Create opening entry to begin</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className={cn("block text-sm font-medium mb-1", textMuted)}>
                POS Profile
              </label>
              <div className={cn("rounded-lg p-3 flex items-center justify-between", bgButton)}>
                <span>{selectedProfile.name}</span>
                {posProfiles.length > 1 && (
                  <button
                    onClick={() => {
                      setShowOpeningDialog(false);
                      setShowProfileSelector(true);
                    }}
                    className="text-sm text-orange-500 hover:underline"
                  >
                    Change
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className={cn("block text-sm font-medium mb-2", textMuted)}>
                Opening Balances
              </label>
              <div className="space-y-3">
                {openingBalances.map((balance, index) => (
                  <div key={balance.mode_of_payment} className={cn("rounded-lg p-3", bgButton)}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{balance.mode_of_payment}</span>
                      {paymentIcons[balance.mode_of_payment] || <Banknote className="h-4 w-4" />}
                    </div>
                    <input
                      type="number"
                      value={balance.opening_amount}
                      onChange={(e) => {
                        const newBalances = [...openingBalances];
                        newBalances[index].opening_amount = Number(e.target.value);
                        setOpeningBalances(newBalances);
                      }}
                      className={cn(
                        "w-full rounded-lg p-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-orange-500",
                        bgCard
                      )}
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleCreateOpeningEntry}
              className="w-full rounded-lg bg-orange-500 py-4 font-semibold text-white hover:bg-orange-600"
            >
              Start Session
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Waiting for profile selection or session initialization
  if (!selectedProfile || hasOpeningEntry === null) {
    return (
      <div className={cn("flex h-screen items-center justify-center", bgMain)}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className={cn("flex h-screen", bgMain, textMain)}>
      {/* Left Panel - Menu Items */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className={cn("flex h-16 items-center justify-between border-b px-4", borderColor)}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-white">
              <UtensilsCrossed className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">ServePOS</h1>
              <p className={cn("text-xs", textMuted)}>{selectedProfile.name}</p>
            </div>
          </div>

          {/* Order Type Selector */}
          <div className="flex items-center gap-1 rounded-lg bg-zinc-800 p-1">
            {(["Dine In", "Takeaway", "Delivery"] as OrderType[]).map((type) => (
              <button
                key={type}
                onClick={() => setOrderType(type)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  orderType === type
                    ? "bg-orange-500 text-white"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-64">
            <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", textMuted)} />
            <input
              type="text"
              placeholder="Search menu..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "w-full rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500",
                bgInput,
                borderColor,
                "border"
              )}
            />
          </div>

          {/* Nav Links */}
          <nav className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className={cn("flex h-9 w-9 items-center justify-center rounded-lg", bgButton, bgButtonHover)}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4 text-yellow-500" /> : <Moon className="h-4 w-4 text-blue-600" />}
            </button>
            <button
              onClick={() => { refreshHistory(); setShowHistoryPanel(true); }}
              className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
            >
              <History className="h-4 w-4" />
              Orders
            </button>
            <button
              onClick={openInvoiceSummary}
              className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
            >
              <ClipboardList className="h-4 w-4" />
              Summary
            </button>
            <a href="/pos/tables" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}>
              <LayoutGrid className="h-4 w-4" />
              Tables
            </a>
            <a href="/pos/kds" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}>
              <ChefHat className="h-4 w-4" />
              Kitchen
            </a>
            <button
              onClick={openClosingDialog}
              className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500", bgButton, bgButtonHover)}
              title="Close Session"
            >
              <LogOut className="h-4 w-4" />
              Close
            </button>
          </nav>
        </header>

        {/* Category Tabs */}
        <div className={cn("flex gap-2 border-b p-3 overflow-x-auto", borderColor)}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap",
                selectedCategory === cat
                  ? "bg-orange-500 text-white"
                  : cn(bgButton, textMuted, bgButtonHover)
              )}
            >
              {categoryIcons[cat] || <LayoutGrid className="h-4 w-4" />}
              {cat}
            </button>
          ))}
        </div>

        {/* Menu Grid */}
        <div className="flex-1 overflow-auto p-4">
          {itemsLoading ? (
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredItems?.map((item) => (
                <button
                  key={item.name}
                  onClick={() => handleItemClick(item)}
                  className={cn(
                    "group flex flex-col rounded-xl p-4 text-left transition-all hover:ring-2 hover:ring-orange-500",
                    bgCard,
                    bgCardHover
                  )}
                >
                  <div className={cn(
                    "mb-2 flex h-12 w-12 items-center justify-center rounded-lg text-orange-500 group-hover:bg-orange-500 group-hover:text-white",
                    bgButton
                  )}>
                    {categoryIcons[item.item_group] || <UtensilsCrossed className="h-6 w-6" />}
                  </div>
                  <h3 className="font-medium leading-tight">{item.item_name}</h3>
                  <p className={cn("mt-1 text-xs", textMuted2)}>
                    {item.servepos_kitchen_station || item.item_group}
                  </p>
                  {item.has_variants ? (
                    <p className="mt-auto pt-2 text-sm text-orange-500">Select variant</p>
                  ) : (
                    <p className="mt-auto pt-2 text-lg font-bold text-orange-500">
                      {formatCurrency(item.standard_rate)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Cart */}
      <div className={cn("flex w-96 flex-col border-l", borderColor, bgCard)}>
        {/* Cart Header */}
        <div className={cn("flex items-center justify-between border-b p-4", borderColor)}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/20 text-orange-500">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">Current Order</h2>
              <p className={cn("text-xs", textMuted)}>
                {cart.length} item{cart.length !== 1 ? "s" : ""} - {orderType}
              </p>
            </div>
          </div>
          {cart.length > 0 && (
            <button onClick={clearCart} className={cn("rounded-lg p-2 hover:text-red-500", textMuted, bgButtonHover)}>
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Table & Guest Selection */}
        <div className={cn("flex gap-2 border-b p-3", borderColor)}>
          <select
            value={selectedTable || ""}
            onChange={(e) => setSelectedTable(e.target.value || null)}
            className={cn("flex-1 rounded-lg px-3 py-2 text-sm", bgButton)}
            disabled={orderType !== "Dine In"}
          >
            <option value="">{orderType === "Dine In" ? "Select Table" : "N/A"}</option>
            {tables?.map((t) => (
              <option key={t.name} value={t.name}>
                {t.table_name} ({t.capacity} seats)
              </option>
            ))}
          </select>
          <div className={cn("flex items-center gap-2 rounded-lg px-3", bgButton)}>
            <Users className={cn("h-4 w-4", textMuted)} />
            <button onClick={() => setGuestCount(Math.max(1, guestCount - 1))} className={cn(textMuted, "hover:text-orange-500")}>
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center text-sm">{guestCount}</span>
            <button onClick={() => setGuestCount(guestCount + 1)} className={cn(textMuted, "hover:text-orange-500")}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-auto p-3">
          {cart.length === 0 ? (
            <div className={cn("flex h-full flex-col items-center justify-center", textMuted2)}>
              <ShoppingCart className="mb-3 h-12 w-12" />
              <p>No items in order</p>
              <p className="text-sm">Tap items to add</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <div key={item.id} className={cn("rounded-lg p-3", bgButton)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-medium">{item.item_name}</h4>
                      {item.modifiers.length > 0 && (
                        <p className="text-xs text-orange-500">+ {item.modifiers.map((m) => m.name).join(", ")}</p>
                      )}
                      {item.comment && <p className={cn("text-xs italic", textMuted2)}>"{item.comment}"</p>}
                      <p className={cn("text-sm", textMuted)}>{formatCurrency(item.rate)} each</p>
                    </div>
                    <button onClick={() => removeFromCart(item.id)} className={cn(textMuted2, "hover:text-red-500")}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className={cn("flex items-center gap-2 rounded-lg p-1", bgCard)}>
                      <button onClick={() => updateQty(item.id, -1)} className={cn("rounded p-1", bgButtonHover)}>
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-8 text-center font-medium">{item.qty}</span>
                      <button onClick={() => updateQty(item.id, 1)} className={cn("rounded p-1", bgButtonHover)}>
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <span className="font-semibold text-orange-500">{formatCurrency(item.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart Footer */}
        <div className={cn("border-t p-4", borderColor)}>
          <div className="space-y-2 text-sm">
            <div className={cn("flex justify-between", textMuted)}>
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className={cn("flex justify-between border-t pt-2 text-lg font-bold", borderColor)}>
              <span>Total</span>
              <span className="text-orange-500">{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className={cn("rounded-lg py-3 font-medium", bgButton, bgButtonHover)}>
              <Clock className="mr-2 inline-block h-4 w-4" />
              Hold
            </button>
            <button
              onClick={openPaymentDialog}
              disabled={cart.length === 0}
              className="rounded-lg bg-orange-500 py-3 font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Receipt className="mr-2 inline-block h-4 w-4" />
              Pay {formatCurrency(total)}
            </button>
          </div>
        </div>
      </div>

      {/* Modifier Dialog */}
      {showModifierDialog && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={cn("w-full max-w-md rounded-2xl p-6 max-h-[90vh] overflow-y-auto", bgCard)}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{selectedItem.item_name}</h2>
              <button onClick={() => setShowModifierDialog(false)} className={cn("rounded-lg p-2", bgButtonHover)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            {selectedItem.has_variants && itemVariants && itemVariants.length > 0 && (
              <div className="mb-4">
                <h3 className={cn("text-sm font-medium mb-2", textMuted)}>Select Variant</h3>
                <div className="grid grid-cols-2 gap-2">
                  {itemVariants.map((variant) => (
                    <button
                      key={variant.name}
                      onClick={() => setSelectedVariant(variant)}
                      className={cn(
                        "rounded-lg p-3 text-left",
                        selectedVariant?.name === variant.name ? "bg-orange-500 text-white" : cn(bgButton, bgButtonHover)
                      )}
                    >
                      <p className="font-medium">{variant.item_name}</p>
                      <p className={selectedVariant?.name === variant.name ? "text-white/80" : "text-orange-500"}>
                        {formatCurrency(variant.standard_rate)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {itemModifierGroups.length > 0 && itemModifierGroups.map((group) => (
              <div key={group.group_name} className="mb-4">
                <h3 className={cn("text-sm font-medium mb-2", textMuted)}>
                  {group.group_name}
                  {group.is_required ? <span className="text-red-500 ml-1">*</span> : null}
                  <span className="text-xs ml-2 opacity-60">
                    ({group.selection_type === "Single" ? "Select one" : "Select multiple"})
                  </span>
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {group.modifiers.map((modifier) => (
                    <button
                      key={`${group.group_name}-${modifier.name}`}
                      onClick={() => {
                        if (group.selection_type === "Single") {
                          // Remove any existing modifier from this group, then add new one
                          setSelectedModifiers((prev) => {
                            const otherGroupModifiers = prev.filter(
                              (m) => !group.modifiers.some((gm) => gm.name === m.name)
                            );
                            return [...otherGroupModifiers, modifier];
                          });
                        } else {
                          toggleModifier(modifier);
                        }
                      }}
                      className={cn(
                        "rounded-lg p-3 text-left",
                        selectedModifiers.find((m) => m.name === modifier.name)
                          ? "bg-orange-500 text-white"
                          : cn(bgButton, bgButtonHover)
                      )}
                    >
                      <p className="font-medium">{modifier.name}</p>
                      {modifier.price > 0 && (
                        <p className={selectedModifiers.find((m) => m.name === modifier.name) ? "text-white/80" : "text-orange-500"}>
                          +{formatCurrency(modifier.price)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="mb-4">
              <h3 className={cn("text-sm font-medium mb-2", textMuted)}>Special Instructions</h3>
              <textarea
                value={itemComment}
                onChange={(e) => setItemComment(e.target.value)}
                placeholder="e.g., No ice, Extra sauce..."
                className={cn("w-full rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500", bgButton)}
                rows={2}
              />
            </div>

            <button
              onClick={addToCartWithModifiers}
              disabled={!!selectedItem.has_variants && !selectedVariant}
              className="w-full rounded-lg bg-orange-500 py-3 font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add to Order - {formatCurrency(
                (selectedVariant?.standard_rate || selectedItem.standard_rate) +
                selectedModifiers.reduce((sum, m) => sum + m.price, 0)
              )}
            </button>
          </div>
        </div>
      )}

      {/* Success Dialog */}
      {successOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={cn("w-full max-w-md rounded-2xl p-6 text-center", bgCard)}>
            <div className="flex justify-center mb-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20 text-green-500">
                <Check className="h-8 w-8" />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-2">Order Complete!</h2>
            <p className={cn("text-lg mb-1", textMuted)}>
              Invoice: <span className="font-mono font-medium">{successOrder.name}</span>
            </p>
            <p className="text-2xl font-bold text-orange-500 mb-6">
              {formatCurrency(successOrder.total)}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => {
                  window.open(`/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(invoiceType)}&name=${successOrder.name}&format=ServePOS%20Bill`, "_blank");
                }}
                className={cn("flex items-center justify-center gap-2 rounded-lg py-3 font-medium", bgButton, bgButtonHover)}
              >
                <Printer className="h-4 w-4" />
                Print Bill
              </button>
              <button
                onClick={() => {
                  window.open(`/printpreview?doctype=${encodeURIComponent(invoiceType)}&name=${successOrder.name}&format=ServePOS%20Bill`, "_blank");
                }}
                className={cn("flex items-center justify-center gap-2 rounded-lg py-3 font-medium", bgButton, bgButtonHover)}
              >
                <Receipt className="h-4 w-4" />
                Preview
              </button>
            </div>

            <button
              onClick={() => setSuccessOrder(null)}
              className="w-full rounded-lg bg-green-500 py-4 font-semibold text-white hover:bg-green-600"
            >
              New Order
            </button>
          </div>
        </div>
      )}

      {/* Order History Panel */}
      {showHistoryPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={cn("w-full max-w-2xl max-h-[80vh] rounded-2xl flex flex-col", bgCard)}>
            <div className={cn("flex items-center justify-between p-4 border-b", borderColor)}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20 text-purple-500">
                  <History className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Order History</h2>
                  <p className={cn("text-xs", textMuted)}>{orderHistory?.length || 0} orders</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => refreshHistory()}
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowHistoryPanel(false)}
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {!orderHistory?.length ? (
                <div className={cn("flex flex-col items-center justify-center py-12", textMuted)}>
                  <Receipt className="mb-4 h-12 w-12" />
                  <p className="text-lg">No orders yet</p>
                  <p className="text-sm">Completed orders will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orderHistory.map((order) => (
                    <div
                      key={order.name}
                      className={cn("flex items-center justify-between rounded-lg p-4", bgButton)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{order.name}</span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-xs",
                            order.status === "Paid" ? "bg-green-500/20 text-green-500" :
                            order.status === "Consolidated" ? "bg-blue-500/20 text-blue-500" :
                            "bg-gray-500/20 text-gray-500"
                          )}>
                            {order.status}
                          </span>
                        </div>
                        <div className={cn("flex items-center gap-4 text-sm mt-1", textMuted)}>
                          <span>{order.posting_date} {order.posting_time?.slice(0, 5)}</span>
                          {order.servepos_table && (
                            <span>Table: {order.servepos_table}</span>
                          )}
                          {order.servepos_order_type && (
                            <span>{order.servepos_order_type}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-orange-500">
                          {formatCurrency(order.grand_total)}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => window.open(`/printpreview?doctype=${encodeURIComponent(invoiceType)}&name=${order.name}&format=ServePOS%20Bill`, "_blank")}
                            className={cn("rounded-lg p-2", bgButtonHover)}
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => window.open(`/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(invoiceType)}&name=${order.name}&format=ServePOS%20Bill`, "_blank")}
                            className={cn("rounded-lg p-2", bgButtonHover)}
                            title="Print"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          {order.docstatus === 1 && order.status !== "Return" && (
                            <>
                              <button
                                onClick={() => openReturnDialog({ name: order.name, grand_total: order.grand_total })}
                                className={cn("rounded-lg p-2 text-blue-500", bgButtonHover)}
                                title="Return"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setVoidOrder({ name: order.name, grand_total: order.grand_total });
                                  setShowVoidDialog(true);
                                }}
                                className={cn("rounded-lg p-2 text-red-500", bgButtonHover)}
                                title="Void"
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Summary Dialog */}
      {showInvoiceSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={cn("w-full max-w-5xl max-h-[85vh] rounded-2xl flex flex-col", bgCard)}>
            <div className={cn("flex items-center justify-between p-4 border-b", borderColor)}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/20 text-orange-500">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Invoice Summary</h2>
                  <p className={cn("text-xs", textMuted)}>
                    {invoiceSummaryData.length} invoices today
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={openInvoiceSummary}
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowInvoiceSummary(false)}
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {loadingSummary ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner />
                </div>
              ) : !invoiceSummaryData.length ? (
                <div className={cn("flex flex-col items-center justify-center py-12", textMuted)}>
                  <Receipt className="mb-4 h-12 w-12" />
                  <p className="text-lg">No invoices found</p>
                  <p className="text-sm">Invoices for today will appear here</p>
                </div>
              ) : (
                <>
                  {/* Summary Totals */}
                  <div className={cn("grid grid-cols-3 gap-3 mb-4")}>
                    <div className={cn("rounded-xl p-3 text-center", bgButton)}>
                      <p className={cn("text-xs", textMuted)}>Total Invoices</p>
                      <p className="text-xl font-bold">{invoiceSummaryData.length}</p>
                    </div>
                    <div className={cn("rounded-xl p-3 text-center", bgButton)}>
                      <p className={cn("text-xs", textMuted)}>Grand Total</p>
                      <p className="text-xl font-bold text-orange-500">
                        {formatCurrency(invoiceSummaryData.reduce((s, i) => s + i.grand_total, 0))}
                      </p>
                    </div>
                    <div className={cn("rounded-xl p-3 text-center", bgButton)}>
                      <p className={cn("text-xs", textMuted)}>Total Paid</p>
                      <p className="text-xl font-bold text-green-500">
                        {formatCurrency(invoiceSummaryData.reduce((s, i) => s + i.paid_amount, 0))}
                      </p>
                    </div>
                  </div>

                  {/* Invoice Table */}
                  <div className="overflow-x-auto rounded-xl border border-opacity-20" style={{ borderColor: 'rgba(128,128,128,0.2)' }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className={cn(bgButton)}>
                          <th className="px-4 py-3 text-left font-semibold">#</th>
                          <th className="px-4 py-3 text-left font-semibold">Invoice No</th>
                          <th className="px-4 py-3 text-left font-semibold">Order No</th>
                          <th className="px-4 py-3 text-left font-semibold">Time</th>
                          <th className="px-4 py-3 text-right font-semibold">Grand Total</th>
                          <th className="px-4 py-3 text-right font-semibold">Paid Amount</th>
                          <th className="px-4 py-3 text-left font-semibold">Mode of Payment</th>
                          <th className="px-4 py-3 text-center font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceSummaryData.map((inv, idx) => (
                          <tr
                            key={inv.name}
                            className={cn(
                              "border-t border-opacity-10",
                              idx % 2 === 0 ? "" : bgButton
                            )}
                            style={{ borderColor: 'rgba(128,128,128,0.1)' }}
                          >
                            <td className={cn("px-4 py-3", textMuted)}>{idx + 1}</td>
                            <td className="px-4 py-3 font-mono text-xs">{inv.name}</td>
                            <td className="px-4 py-3 font-mono text-xs">{inv.servepos_order_number || "-"}</td>
                            <td className={cn("px-4 py-3 text-xs", textMuted)}>
                              {inv.posting_time?.slice(0, 5)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-orange-500">
                              {formatCurrency(inv.grand_total)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-green-500">
                              {formatCurrency(inv.paid_amount)}
                            </td>
                            <td className="px-4 py-3 text-xs">{inv.mode_of_payment || "-"}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs",
                                inv.status === "Paid" ? "bg-green-500/20 text-green-500" :
                                inv.status === "Consolidated" ? "bg-blue-500/20 text-blue-500" :
                                inv.status === "Cancelled" ? "bg-red-500/20 text-red-500" :
                                "bg-gray-500/20 text-gray-500"
                              )}>
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Dialog */}
      {showPaymentDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={cn("w-full max-w-lg rounded-2xl p-6", bgCard)}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Payment</h2>
              <button onClick={() => setShowPaymentDialog(false)} className={cn("rounded-lg p-2", bgButtonHover)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Total Summary */}
            <div className={cn("rounded-xl p-4 mb-6", bgButton)}>
              <div className="flex justify-between text-lg mb-2">
                <span>Total</span>
                <span className="font-bold text-orange-500">{formatCurrency(total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className={textMuted}>Paid</span>
                <span className="text-green-500">{formatCurrency(paidAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className={textMuted}>Remaining</span>
                <span className={remainingAmount > 0 ? "text-red-500" : "text-green-500"}>
                  {formatCurrency(Math.max(0, remainingAmount))}
                </span>
              </div>
              {paidAmount > total && (
                <div className="flex justify-between text-sm mt-1">
                  <span className={textMuted}>Change</span>
                  <span className="text-blue-500">{formatCurrency(paidAmount - total)}</span>
                </div>
              )}
            </div>

            {/* Payment Modes - Click to pay exact remaining amount */}
            <div className="mb-6">
              <h3 className={cn("text-sm font-medium mb-3", textMuted)}>Pay with (tap to pay full amount)</h3>
              <div className="grid grid-cols-3 gap-2">
                {paymentModes.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      if (remainingAmount > 0) {
                        addPayment(mode, remainingAmount);
                      }
                    }}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg p-4 transition-all",
                      payments.find(p => p.mode === mode)
                        ? "bg-green-500 text-white"
                        : cn(bgButton, bgButtonHover, "hover:ring-2 hover:ring-orange-500")
                    )}
                    disabled={remainingAmount <= 0}
                  >
                    {paymentIcons[mode] || <Banknote className="h-5 w-5" />}
                    <span className="text-sm font-medium">{mode}</span>
                    {payments.find(p => p.mode === mode) && (
                      <span className="text-xs">{formatCurrency(payments.find(p => p.mode === mode)?.amount || 0)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Split Payment - Quick Amount Buttons */}
            {remainingAmount > 0 && remainingAmount < total && (
              <div className="mb-6">
                <h3 className={cn("text-sm font-medium mb-3", textMuted)}>Add more (split payment)</h3>
                <div className="grid grid-cols-4 gap-2">
                  {[remainingAmount, 50, 100, 200].filter(a => a > 0).map((amount, i) => (
                    <button
                      key={i}
                      onClick={() => paymentModes[0] && addPayment(paymentModes[0], amount)}
                      className={cn("rounded-lg py-2 text-sm font-medium", bgButton, bgButtonHover)}
                    >
                      {amount === remainingAmount ? "Exact" : formatCurrency(amount)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Entries */}
            {payments.length > 0 && (
              <div className="mb-6">
                <h3 className={cn("text-sm font-medium mb-3", textMuted)}>Payments</h3>
                <div className="space-y-2">
                  {payments.map((p, i) => (
                    <div key={i} className={cn("flex items-center justify-between rounded-lg p-3", bgButton)}>
                      <div className="flex items-center gap-2">
                        {paymentIcons[p.mode] || <Banknote className="h-4 w-4" />}
                        <span>{p.mode}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatCurrency(p.amount)}</span>
                        <button
                          onClick={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-red-500 hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={submitOrder}
              disabled={isSubmitting || paidAmount < total}
              className={cn(
                "w-full rounded-lg py-4 font-semibold text-white",
                paidAmount >= total
                  ? "bg-green-500 hover:bg-green-600"
                  : "bg-gray-500 cursor-not-allowed"
              )}
            >
              {isSubmitting ? (
                <RefreshCw className="inline-block h-5 w-5 animate-spin mr-2" />
              ) : (
                <Check className="inline-block h-5 w-5 mr-2" />
              )}
              {isSubmitting ? "Processing..." : `Complete Order (${formatCurrency(total)})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
