import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format currency based on locale (Qatar - QAR)
 */
export function formatCurrency(
  amount: number,
  currency: string = "QAR",
  locale: string = "en-QA"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format time elapsed (for KDS)
 */
export function formatTimeElapsed(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${hours}h ${mins}m`;
}

/**
 * Get status color class for KDS
 */
export function getKOTStatusColor(
  createdAt: string,
  warningMins: number = 10,
  dangerMins: number = 20
): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMins = (now.getTime() - created.getTime()) / 60000;

  if (diffMins >= dangerMins) return "border-destructive bg-destructive/10";
  if (diffMins >= warningMins) return "border-warning bg-warning/10";
  return "border-border";
}

/**
 * Play notification sound
 */
export function playNotificationSound(type: "newOrder" | "alert" = "newOrder") {
  const audio = new Audio(`/assets/servepos/sounds/${type}.mp3`);
  audio.play().catch(() => {
    // Silently fail if autoplay is blocked
  });
}
