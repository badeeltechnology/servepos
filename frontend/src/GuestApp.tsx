import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CallWaiter from "@/pages/CallWaiter";
import GuestMenuPage from "@/pages/GuestMenuPage";
import GuestCartPage from "@/pages/GuestCartPage";
import GuestOrdersPage from "@/pages/GuestOrdersPage";

/**
 * GuestApp — public-facing app for guests (no auth required).
 * Served at /call-waiter/:seatCode
 *
 * Routes:
 *   /:seatCode              — Restaurant list + call waiter
 *   /:seatCode/menu/:profile — Browse menu for a restaurant
 *   /:seatCode/cart/:profile — Review cart + place order
 *   /:seatCode/orders       — View all orders for this session
 */
export default function GuestApp() {
  return (
    <BrowserRouter basename="/call-waiter">
      <Routes>
        <Route path="/:seatCode" element={<CallWaiter />} />
        <Route path="/:seatCode/menu/:posProfile" element={<GuestMenuPage />} />
        <Route path="/:seatCode/cart/:posProfile" element={<GuestCartPage />} />
        <Route path="/:seatCode/orders" element={<GuestOrdersPage />} />
        <Route
          path="/"
          element={
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
              <div className="text-6xl mb-4">📱</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Scan a QR Code
              </h2>
              <p className="text-gray-500 text-center max-w-sm">
                Please scan the QR code on your seat or table to view the menu
                and place your order.
              </p>
            </div>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
