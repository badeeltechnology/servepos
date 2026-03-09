import { useState, useEffect } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
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

const availableModifiers: Modifier[] = [
  { name: "Extra Cheese", price: 5 },
  { name: "Extra Spicy", price: 0 },
  { name: "No Onion", price: 0 },
  { name: "No Garlic", price: 0 },
  { name: "Add Bacon", price: 8 },
  { name: "Gluten Free", price: 10 },
];

type OrderType = "Dine In" | "Takeaway" | "Delivery";

export default function POSPage() {
  const { theme, toggleTheme } = useTheme();
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState(2);
  const [orderType, setOrderType] = useState<OrderType>("Dine In");

  // Opening entry state
  const [hasOpeningEntry, setHasOpeningEntry] = useState<boolean | null>(null);
  const [showOpeningDialog, setShowOpeningDialog] = useState(false);
  const [openingCash, setOpeningCash] = useState(0);

  // Modifier dialog state
  const [showModifierDialog, setShowModifierDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<Modifier[]>([]);
  const [itemComment, setItemComment] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<ItemVariant | null>(null);

  // Payment dialog state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);

  // Order status
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check for POS Opening Entry
  const { data: openingEntries, mutate: refreshOpeningEntry } = useFrappeGetDocList(
    "POS Opening Entry",
    {
      fields: ["name", "pos_profile", "status"],
      filters: [
        ["user", "=", "Administrator"],
        ["status", "=", "Open"],
        ["docstatus", "=", 1],
      ],
      limit: 1,
    }
  );

  // Fetch POS Profile
  const { data: posProfiles, isLoading: profileLoading } = useFrappeGetDocList(
    "POS Profile",
    {
      fields: ["name", "warehouse", "company", "customer", "currency", "selling_price_list"],
      filters: [["disabled", "=", 0]],
      limit: 1,
    }
  );

  // Fetch POS Profile payments
  const { data: posProfilePayments } = useFrappeGetDocList(
    "POS Payment Method",
    {
      fields: ["mode_of_payment", "default"],
      filters: posProfiles?.length ? [["parent", "=", posProfiles[0].name]] : [],
      limit: 10,
    }
  );

  // Fetch Item Groups
  const { data: itemGroups } = useFrappeGetDocList("Item Group", {
    fields: ["name"],
    filters: [
      ["parent_item_group", "=", "Menu Items"],
      ["is_group", "=", 0],
    ],
  });

  // Fetch Menu Items
  const { data: menuItems, isLoading: itemsLoading } = useFrappeGetDocList<MenuItem>(
    "Item",
    {
      fields: [
        "name",
        "item_name",
        "item_group",
        "standard_rate",
        "servepos_modifiers",
        "servepos_kitchen_station",
        "has_variants",
        "variant_of",
      ],
      filters: [
        ["is_sales_item", "=", 1],
        ["item_group", "in", ["Main Course", "Beverages", "Starters", "Desserts"]],
        ["variant_of", "=", ""],
      ],
      limit: 100,
    }
  );

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

  // Fetch Tables
  const { data: tables, mutate: refreshTables } = useFrappeGetDocList("ServePOS Table", {
    fields: ["name", "table_name", "room", "status", "capacity"],
    filters: [["status", "=", "Available"]],
  });

  // Check opening entry on load
  useEffect(() => {
    if (openingEntries !== undefined) {
      if (openingEntries.length > 0) {
        setHasOpeningEntry(true);
      } else {
        setHasOpeningEntry(false);
        setShowOpeningDialog(true);
      }
    }
  }, [openingEntries]);

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

  const handleItemClick = (item: MenuItem) => {
    if (item.has_variants || item.servepos_modifiers) {
      setSelectedItem(item);
      setSelectedModifiers([]);
      setItemComment("");
      setSelectedVariant(null);
      setShowModifierDialog(true);
    } else {
      addToCartDirect(item);
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

  // Create Opening Entry
  const createOpeningEntry = async () => {
    if (!posProfiles?.length) return;

    try {
      const doc = {
        doctype: "POS Opening Entry",
        pos_profile: posProfiles[0].name,
        company: posProfiles[0].company,
        user: "Administrator",
        period_start_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
        balance_details: [
          {
            mode_of_payment: "Cash",
            opening_amount: openingCash,
          },
        ],
      };

      const response = await fetch("/api/resource/POS Opening Entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": window.csrf_token || "",
        },
        body: JSON.stringify(doc),
      });

      if (response.ok) {
        const data = await response.json();
        // Submit the entry
        await fetch(`/api/resource/POS Opening Entry/${data.data.name}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token": window.csrf_token || "",
          },
          body: JSON.stringify({ docstatus: 1 }),
        });

        setHasOpeningEntry(true);
        setShowOpeningDialog(false);
        refreshOpeningEntry();
      }
    } catch (error) {
      console.error("Error creating opening entry:", error);
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
    if (!posProfiles?.length || cart.length === 0) return;
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
        mode_of_payment: p.mode || "Cash",  // Fallback to Cash if mode is undefined
        amount: p.amount,
      }));

      console.log("Payments state:", payments);
      console.log("Payment entries:", paymentEntries);

      // Get current date/time
      const now = new Date();
      const postingDate = now.toISOString().split('T')[0];
      const postingTime = now.toTimeString().split(' ')[0];

      const invoiceData = {
        doctype: "POS Invoice",
        customer: posProfiles[0].customer || "Walk-in Customer",
        company: posProfiles[0].company,
        pos_profile: posProfiles[0].name,
        is_pos: 1,
        posting_date: postingDate,
        posting_time: postingTime,
        set_warehouse: posProfiles[0].warehouse,
        currency: posProfiles[0].currency || "QAR",
        selling_price_list: posProfiles[0].selling_price_list || "Standard Selling",
        servepos_table: selectedTable || "",
        servepos_order_type: orderType,
        servepos_guests: guestCount,
        items,
        payments: paymentEntries,
      };

      console.log("Creating POS Invoice:", invoiceData);

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
      console.log("Response:", responseData);

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
          alert(`Order ${invoiceName} placed successfully!`);
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

  if (profileLoading || hasOpeningEntry === null) {
    return (
      <div className={cn("flex h-screen items-center justify-center", bgMain)}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!posProfiles?.length) {
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

  // Opening Entry Dialog
  if (showOpeningDialog && !hasOpeningEntry) {
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
              <div className={cn("rounded-lg p-3", bgButton)}>{posProfiles[0].name}</div>
            </div>

            <div>
              <label className={cn("block text-sm font-medium mb-1", textMuted)}>
                Opening Cash Balance
              </label>
              <input
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(Number(e.target.value))}
                className={cn(
                  "w-full rounded-lg p-3 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-orange-500",
                  bgButton
                )}
                placeholder="0.00"
              />
            </div>

            <button
              onClick={createOpeningEntry}
              className="w-full rounded-lg bg-orange-500 py-4 font-semibold text-white hover:bg-orange-600"
            >
              Start Session
            </button>
          </div>
        </div>
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
              <p className={cn("text-xs", textMuted)}>{posProfiles[0].name}</p>
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
            <a href="/pos/tables" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}>
              <LayoutGrid className="h-4 w-4" />
              Tables
            </a>
            <a href="/pos/kds" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", bgButton, bgButtonHover)}>
              <ChefHat className="h-4 w-4" />
              Kitchen
            </a>
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

            <div className="mb-4">
              <h3 className={cn("text-sm font-medium mb-2", textMuted)}>Add-ons & Modifiers</h3>
              <div className="grid grid-cols-2 gap-2">
                {availableModifiers.map((modifier) => (
                  <button
                    key={modifier.name}
                    onClick={() => toggleModifier(modifier)}
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
