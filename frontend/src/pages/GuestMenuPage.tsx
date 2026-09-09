import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import GuestMenu, { type CartItem } from "./GuestMenu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useGuestSession } from "@/hooks/useGuestSession";

export default function GuestMenuPage() {
  const { seatCode, posProfile } = useParams<{ seatCode: string; posProfile: string }>();
  const navigate = useNavigate();
  const { token, restaurantName, loading, error } = useGuestSession(seatCode || "");
  const [cart, setCart] = useCartState(seatCode || "", posProfile || "");

  if (!seatCode || !posProfile) {
    return <ErrorView message="Invalid link. Please scan the QR code again." />;
  }

  if (loading) {
    return (
      <GuestShell seatCode={seatCode}>
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <LoadingSpinner size="lg" />
        </div>
      </GuestShell>
    );
  }

  if (error || !token) {
    return (
      <GuestShell seatCode={seatCode}>
        <ErrorView message={error || "Session expired. Please scan the QR code again."} />
      </GuestShell>
    );
  }

  return (
    <GuestShell seatCode={seatCode} showBack onBack={() => navigate(`/${seatCode}`)} title={restaurantName}>
      <GuestMenu
        seatCode={seatCode}
        posProfile={posProfile}
        token={token}
        cart={cart}
        setCart={setCart}
        restaurantName={restaurantName}
      />
    </GuestShell>
  );
}

// --- Shared helpers ---

function GuestShell({
  children,
  seatCode,
  showBack,
  onBack,
  title,
}: {
  children: React.ReactNode;
  seatCode?: string;
  showBack?: boolean;
  onBack?: () => void;
  title?: string;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {(showBack || title) && (
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
            {showBack && onBack && (
              <button
                onClick={onBack}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {title && (
              <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
            )}
          </div>
        </div>
      )}
      <div className="max-w-lg mx-auto">{children}</div>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
      <div className="text-6xl mb-4">📱</div>
      <p className="text-gray-500 text-center max-w-sm">{message}</p>
    </div>
  );
}

// Cart state persisted in sessionStorage
function useCartState(seatCode: string, posProfile: string): [CartItem[], React.Dispatch<React.SetStateAction<CartItem[]>>] {
  const key = `servepos_cart_${seatCode}_${posProfile}`;
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    sessionStorage.setItem(key, JSON.stringify(cart));
  }, [cart, key]);

  return [cart, setCart];
}

export { GuestShell, ErrorView, useCartState };
