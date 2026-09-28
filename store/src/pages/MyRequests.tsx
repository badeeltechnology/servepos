import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useProfile } from "@/App";
import { useNavigate } from "react-router-dom";
import { Clock, CheckCircle, AlertCircle, XCircle, ChevronRight } from "lucide-react";

const statusColors: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Pending: "bg-amber-50 text-amber-700",
  "Partially Fulfilled": "bg-blue-50 text-blue-700",
  Fulfilled: "bg-green-50 text-green-700",
  Cancelled: "bg-red-50 text-red-500",
};

const statusIcons: Record<string, any> = {
  Draft: Clock,
  Pending: AlertCircle,
  "Partially Fulfilled": Clock,
  Fulfilled: CheckCircle,
  Cancelled: XCircle,
};

export default function MyRequests() {
  const { profile, profiles } = useProfile();
  const navigate = useNavigate();
  const selectedProfile = profiles.find((p) => p.name === profile);
  const branch = selectedProfile?.branch;

  const [filter, setFilter] = useState<string>("");

  const { data, isLoading } = useFrappeGetCall(
    "servepos.api.store.get_my_requests",
    { branch: branch || undefined, status: filter || undefined }
  );
  const requests: any[] = data?.message || [];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900">My Requests</h1>
        <p className="text-sm text-gray-500">{branch || "All branches"} — {requests.length} requests</p>
      </div>

      {/* Status filter */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {["", "Pending", "Partially Fulfilled", "Fulfilled", "Cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium ${filter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {/* Request list */}
      <div className="space-y-2">
        {requests.map((req) => {
          const StatusIcon = statusIcons[req.status] || Clock;
          return (
            <button
              key={req.name}
              onClick={() => navigate(`/requests/${req.name}`)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start gap-3 min-w-0">
                <StatusIcon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${req.status === "Fulfilled" ? "text-green-500" : req.status === "Cancelled" ? "text-red-400" : "text-amber-500"}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-gray-900">{req.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[req.status] || "bg-gray-100 text-gray-600"}`}>
                      {req.status}
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-500">
                    {req.item_count} items · Required by {req.required_by}
                  </p>
                  {req.notes && <p className="mt-0.5 truncate text-[11px] text-gray-400">{req.notes}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right hidden sm:block">
                  <p className="text-[11px] text-gray-400">{req.request_date}</p>
                  <p className="text-[11px] text-gray-400">{req.branch}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </div>
            </button>
          );
        })}
      </div>

      {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading...</div>}
      {!isLoading && requests.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-400">No requests found</div>
      )}
    </div>
  );
}
