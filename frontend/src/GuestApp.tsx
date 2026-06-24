import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CallWaiter from "@/pages/CallWaiter";

/**
 * GuestApp — public-facing app for guests (no auth required).
 * Served at /call-waiter/:seatCode
 */
export default function GuestApp() {
  return (
    <BrowserRouter basename="/call-waiter">
      <Routes>
        <Route path="/:seatCode" element={<CallWaiter />} />
        <Route
          path="/"
          element={
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
              <div className="text-6xl mb-4">📱</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Scan a QR Code
              </h2>
              <p className="text-gray-500 text-center max-w-sm">
                Please scan the QR code on your seat or table to call a waiter.
              </p>
            </div>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
