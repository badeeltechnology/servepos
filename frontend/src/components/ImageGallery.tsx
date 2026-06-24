import { useState, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface GalleryImage {
  image: string;
  caption?: string;
  display_order?: number;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  className?: string;
}

export function ImageGallery({ images, className }: ImageGalleryProps) {
  const [current, setCurrent] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchDelta, setTouchDelta] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const total = images.length;

  const goTo = useCallback(
    (index: number) => {
      if (index < 0) setCurrent(total - 1);
      else if (index >= total) setCurrent(0);
      else setCurrent(index);
      setTouchDelta(0);
    },
    [total]
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoomed) return;
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null || zoomed) return;
    const delta = e.touches[0].clientX - touchStart;
    setTouchDelta(delta);
  };

  const handleTouchEnd = () => {
    if (touchStart === null || zoomed) return;
    const threshold = 50;
    if (touchDelta < -threshold) {
      goTo(current + 1);
    } else if (touchDelta > threshold) {
      goTo(current - 1);
    } else {
      setTouchDelta(0);
    }
    setTouchStart(null);
  };

  if (!images.length) return null;

  if (images.length === 1) {
    return (
      <div className={cn("relative w-full", className)}>
        <img
          src={images[0].image}
          alt={images[0].caption || "Menu"}
          className="w-full rounded-lg object-contain max-h-[60vh] cursor-zoom-in"
          onClick={() => setZoomed(true)}
        />
        {images[0].caption && (
          <p className="text-center text-sm text-gray-500 mt-1">
            {images[0].caption}
          </p>
        )}
        {zoomed && (
          <ZoomedView
            image={images[0].image}
            caption={images[0].caption}
            onClose={() => setZoomed(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative w-full select-none", className)}>
      {/* Image container */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(calc(-${current * 100}% + ${touchDelta}px))`,
            ...(touchDelta !== 0
              ? { transition: "none" }
              : {}),
          }}
        >
          {images.map((img, i) => (
            <div key={i} className="w-full flex-shrink-0">
              <img
                src={img.image}
                alt={img.caption || `Menu ${i + 1}`}
                className="w-full object-contain max-h-[60vh] cursor-zoom-in"
                onClick={() => setZoomed(true)}
                draggable={false}
              />
            </div>
          ))}
        </div>

        {/* Arrow buttons (hidden on touch, visible on hover for desktop) */}
        <button
          onClick={() => goTo(current - 1)}
          className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur-sm rounded-full p-1.5 shadow-md hover:bg-white transition-colors hidden sm:block"
          aria-label="Previous"
        >
          <ChevronLeft className="w-5 h-5 text-gray-700" />
        </button>
        <button
          onClick={() => goTo(current + 1)}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur-sm rounded-full p-1.5 shadow-md hover:bg-white transition-colors hidden sm:block"
          aria-label="Next"
        >
          <ChevronRight className="w-5 h-5 text-gray-700" />
        </button>

        {/* Page counter */}
        <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
          {current + 1} / {total}
        </div>
      </div>

      {/* Caption */}
      {images[current]?.caption && (
        <p className="text-center text-sm text-gray-500 mt-1">
          {images[current].caption}
        </p>
      )}

      {/* Dots */}
      <div className="flex justify-center gap-1.5 mt-2">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={cn(
              "w-2 h-2 rounded-full transition-all duration-200",
              i === current
                ? "bg-gray-800 w-4"
                : "bg-gray-300 hover:bg-gray-400"
            )}
            aria-label={`Go to image ${i + 1}`}
          />
        ))}
      </div>

      {/* Zoomed overlay */}
      {zoomed && (
        <ZoomedView
          image={images[current].image}
          caption={images[current].caption}
          onClose={() => setZoomed(false)}
        />
      )}
    </div>
  );
}

function ZoomedView({
  image,
  caption,
  onClose,
}: {
  image: string;
  caption?: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white bg-white/20 rounded-full p-2 hover:bg-white/30"
        aria-label="Close"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
      <img
        src={image}
        alt={caption || "Menu"}
        className="max-w-full max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
