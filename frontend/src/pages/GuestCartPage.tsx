import { useParams, useNavigate } from "react-router-dom";
import GuestCart from "./GuestCart";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useGuestSession } from "@/hooks/useGuestSession";
import { GuestShell, ErrorView, useCartState } from "./GuestMenuPage";

export default function GuestCartPage() {
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
    <GuestShell seatCode={seatCode}>
      <GuestCart
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
