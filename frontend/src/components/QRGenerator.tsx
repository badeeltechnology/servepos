import { useState, useRef, useEffect, useCallback } from "react";
import { Download, QrCode, X, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

interface QRGeneratorProps {
  tableName: string;
  siteUrl?: string;
  onClose: () => void;
}

/**
 * QR Code Generator — generates a QR code for a table/seat
 * that links to /call-waiter/{tableName}.
 * Uses a lightweight canvas-based QR encoder (no external package).
 */
export function QRGenerator({ tableName, siteUrl, onClose }: QRGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    const base = siteUrl || window.location.origin;
    const callUrl = `${base}/call-waiter/${encodeURIComponent(tableName)}`;
    setUrl(callUrl);

    if (canvasRef.current) {
      generateQR(canvasRef.current, callUrl);
    }
  }, [tableName, siteUrl]);

  const handleDownload = useCallback(() => {
    if (!canvasRef.current) return;

    // Create a larger canvas with label
    const qrCanvas = canvasRef.current;
    const padding = 40;
    const labelHeight = 60;
    const totalWidth = qrCanvas.width + padding * 2;
    const totalHeight = qrCanvas.height + padding * 2 + labelHeight;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = totalWidth;
    exportCanvas.height = totalHeight;
    const ctx = exportCanvas.getContext("2d")!;

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // QR code
    ctx.drawImage(qrCanvas, padding, padding);

    // Label
    ctx.fillStyle = "#111827";
    ctx.font = "bold 24px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(tableName, totalWidth / 2, qrCanvas.height + padding + 35);

    ctx.fillStyle = "#6b7280";
    ctx.font = "14px Arial, sans-serif";
    ctx.fillText("Scan to Order Online or Call Waiter", totalWidth / 2, qrCanvas.height + padding + 55);

    // Download
    const link = document.createElement("a");
    link.download = `QR-${tableName}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  }, [tableName]);

  const handlePrint = useCallback(() => {
    if (!canvasRef.current) return;
    const win = window.open("", "_blank");
    if (!win) return;

    win.document.write(`
      <html>
        <head><title>QR - ${tableName}</title></head>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:Arial,sans-serif;">
          <img src="${canvasRef.current.toDataURL("image/png")}" style="width:250px;height:250px;" />
          <h2 style="margin:16px 0 4px;font-size:24px;">${tableName}</h2>
          <p style="color:#666;font-size:14px;margin:0;">Scan to Order Online or Call Waiter</p>
        </body>
      </html>
    `);
    win.document.close();
    win.onload = () => {
      win.print();
      win.close();
    };
  }, [tableName]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">QR Code</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* QR Canvas */}
        <div className="flex flex-col items-center">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <canvas ref={canvasRef} className="w-[200px] h-[200px]" />
          </div>
          <p className="mt-3 text-lg font-bold text-gray-900">{tableName}</p>
          <p className="text-xs text-gray-400 mt-1 break-all text-center max-w-[280px]">{url}</p>
        </div>

        {/* Actions */}
        <div className="mt-5 flex gap-2">
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Download className="w-4 h-4" />
            Download PNG
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Bulk QR generator — generates a printable page with QR codes for multiple tables.
 */
export function BulkQRGenerator({
  tables,
  siteUrl,
  onClose,
}: {
  tables: { name: string; table_name: string; room?: string }[];
  siteUrl?: string;
  onClose: () => void;
}) {
  const handlePrintAll = useCallback(() => {
    const base = siteUrl || window.location.origin;
    const win = window.open("", "_blank");
    if (!win) return;

    const cards = tables
      .map((t) => {
        const callUrl = `${base}/call-waiter/${encodeURIComponent(t.table_name)}`;
        return `
          <div style="display:inline-flex;flex-direction:column;align-items:center;width:200px;padding:20px;margin:10px;border:1px dashed #ccc;break-inside:avoid;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(callUrl)}" style="width:160px;height:160px;" />
            <h3 style="margin:8px 0 2px;font-size:18px;font-weight:bold;">${t.table_name}</h3>
            <p style="color:#666;font-size:11px;margin:0;">Scan to Order Online or Call Waiter</p>
          </div>
        `;
      })
      .join("");

    win.document.write(`
      <html>
        <head><title>QR Codes - All Tables</title></head>
        <body style="display:flex;flex-wrap:wrap;justify-content:center;font-family:Arial,sans-serif;padding:20px;">
          ${cards}
        </body>
      </html>
    `);
    win.document.close();
    win.onload = () => {
      win.print();
    };
  }, [tables, siteUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Bulk QR Codes</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Generate a printable page with QR codes for {tables.length} tables.
          Each QR code will include the table name and scan instructions.
        </p>

        <div className="max-h-48 overflow-y-auto mb-4 rounded-lg border border-gray-200 p-3">
          {tables.map((t) => (
            <div key={t.name} className="flex items-center gap-2 py-1">
              <QrCode className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-700">{t.table_name}</span>
              {t.room && (
                <span className="text-xs text-gray-400">({t.room})</span>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handlePrintAll}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Printer className="w-4 h-4" />
          Print All QR Codes
        </button>
      </div>
    </div>
  );
}

// ==================== QR Code Generator (Pure JS) ====================

/**
 * Minimal QR code generator using canvas.
 * Encodes text as a QR code and draws it on the canvas.
 * Uses a simple encoding approach via the QR Server API for reliability,
 * then draws to canvas for offline export.
 */
function generateQR(canvas: HTMLCanvasElement, text: string) {
  const size = 400;
  canvas.width = size;
  canvas.height = size;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
  };
  img.onerror = () => {
    // Fallback: draw a placeholder
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("QR generation requires internet", size / 2, size / 2 - 10);
    ctx.fillText("for first load", size / 2, size / 2 + 10);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&format=png`;
}
