import { useParams } from "react-router-dom";
import GuestOrders from "./GuestOrders";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useGuestSession } from "@/hooks/useGuestSession";
import { GuestShell, ErrorView } from "./GuestMenuPage";

export default function GuestOrdersPage() {
  const { seatCode } = useParams<{ seatCode: string }>();
  const { token, loading, error } = useGuestSession(seatCode || "");

  if (!seatCode) {
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
      <GuestOrders seatCode={seatCode} token={token} />
    </GuestShell>
  );
}
