import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { RouteErrorState } from "@/components/ui/route-error-state";
import { fetchJson, isRateLimitedApiError } from "@/lib/api";
import { isServerConfigReady } from "@/lib/config";
import { useServerConfig } from "@/lib/use-server-config";
import { type StatsPayload } from "@/components/stats/StatsDashboard";

const StatsDashboard = lazy(async () => {
  const module = await import("@/components/stats/StatsDashboard");
  return { default: module.StatsDashboard };
});

export default function StatsPage() {
  const [pantryPeriod, setPantryPeriod] = useState<"30" | "90" | "365" | "all">("30");
  const config = useServerConfig();
  const apiReady = isServerConfigReady(config);
  const statsQuery = useQuery({
    queryKey: ["stats", pantryPeriod],
    enabled: apiReady,
    retry: (failureCount, error) =>
      isRateLimitedApiError(error) ? failureCount < 1 : failureCount < 2,
    queryFn: () =>
      fetchJson<{ data: StatsPayload }>(`/api/stats?pantryPeriod=${pantryPeriod}`).then(
        (response) => response.data
      ),
  });

  if (statsQuery.isLoading) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-text-muted">Loading stats...</p>
      </div>
    );
  }

  if (statsQuery.isError || !statsQuery.data) {
    const isRateLimited = isRateLimitedApiError(statsQuery.error);
    return (
      <div className="p-4 md:p-6">
        <RouteErrorState
          className="max-w-xl p-4"
          description={
            isRateLimited
              ? "Please try again in a moment."
              : "Check your connection and retry."
          }
          onRetry={() => {
            void statsQuery.refetch();
          }}
          title={
            isRateLimited
              ? "Requests are coming in too quickly right now."
              : "Unable to load stats right now."
          }
        />
      </div>
    );
  }

  return (
    <Suspense
      fallback={<p className="text-sm text-text-muted">Loading charts...</p>}
    >
      <StatsDashboard pantryPeriod={pantryPeriod} onPantryPeriodChange={setPantryPeriod} stats={statsQuery.data} />
    </Suspense>
  );
}
