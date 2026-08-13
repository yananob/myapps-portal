"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Loader2, RefreshCw, AlertCircle, X, Eye, EyeOff } from "lucide-react";
import { ServiceCard } from "@/components/ServiceCard";
import { cn } from "@/lib/utils";
import { ServiceGroup } from "@/lib/types";

export default function Dashboard() {
  const [serviceGroups, setServiceGroups] = useState<ServiceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const CACHE_KEY = "myapps-portal-cache";
  const CACHE_TIME_KEY = "myapps-portal-cache-time";
  const HIDDEN_KEY = "myapps-portal-hidden";

  const fetchServices = async (useCache = true) => {
    setLoading(true);
    setError(null);

    // キャッシュの読み込み
    if (useCache) {
      const cachedData = localStorage.getItem(CACHE_KEY);
      const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
      if (cachedData && cachedTime) {
        setServiceGroups(JSON.parse(cachedData));
        setLastUpdated(new Date(parseInt(cachedTime)));
        setLoading(false);
        // キャッシュがある場合はバックグラウンドで更新するなどの検討もできるが、
        // ユーザーの要望「最新化にはリロードボタン押下」に従い、ここでは終了する
        return;
      }
    }

    try {
      const response = await fetch("/api/services");
      const data = await response.json();

      if (response.ok) {
        setServiceGroups(data);
        const now = new Date();
        setLastUpdated(now);
        // キャッシュの保存
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIME_KEY, now.getTime().toString());
      } else {
        setError(data.error || "Failed to fetch services");
      }
    } catch (err) {
      console.error("Failed to fetch services:", err);
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices(true);
    // 非表示リストの読み込み
    const savedHidden = localStorage.getItem(HIDDEN_KEY);
    if (savedHidden) {
      try {
        setHiddenIds(new Set(JSON.parse(savedHidden)));
      } catch (e) {
        console.error("Failed to parse hidden IDs:", e);
      }
    }
  }, []);

  const toggleHide = (baseName: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(baseName)) {
        next.delete(baseName);
      } else {
        next.add(baseName);
      }
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const filteredGroups = useMemo(() => {
    return serviceGroups
      .filter((group) =>
        group.baseName.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .filter((group) => showHidden || !hiddenIds.has(group.baseName))
      .sort((a, b) => {
        // 非表示のものを下に持ってくる
        const aHidden = hiddenIds.has(a.baseName);
        const bHidden = hiddenIds.has(b.baseName);
        if (aHidden && !bHidden) return 1;
        if (!aHidden && bHidden) return -1;
        return 0;
      });
  }, [serviceGroups, searchQuery, hiddenIds, showHidden]);

  return (
    <main className="container mx-auto px-4 py-8 max-w-7xl">
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            GitHub Apps Manager
          </h1>
          {lastUpdated && !error && (
            <p className="text-sm text-slate-500 mt-1">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>

        <div className="relative flex items-center gap-2">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search apps..."
              className="w-full pl-10 pr-10 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck="false"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-all z-10 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
                title="Clear search"
              >
                <X className="w-4 h-4 stroke-[3px]" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-800 ml-2 pl-2">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className={cn(
                "p-2 transition-colors rounded-md",
                showHidden
                  ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20"
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              )}
              title={showHidden ? "非表示アイテムを隠す" : "非表示アイテムを表示"}
            >
              {showHidden ? (
                <Eye className="w-5 h-5" />
              ) : (
                <EyeOff className="w-5 h-5" />
              )}
            </button>
            <button
              onClick={() => fetchServices(false)}
              disabled={loading}
              className="p-2 text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 disabled:opacity-50 transition-colors"
              title="Refresh list"
            >
              <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-8 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-200">
              Error fetching services
            </h2>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error}
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-2">
              認証エラー（invalid_grant）が発生している場合は、Google Cloud の認証設定やサービスアカウントの権限を確認してください。
            </p>
          </div>
        </div>
      )}

      {loading && serviceGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-slate-500">Loading apps...</p>
        </div>
      ) : (
        <>
          {!error && filteredGroups.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-12 text-center">
              <p className="text-slate-500">No apps found.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredGroups.map((group) => (
                <ServiceCard
                  key={group.baseName}
                  baseName={group.baseName}
                  main={group.main}
                  test={group.test}
                  event={group.event}
                  testEvent={group.testEvent}
                  repoUrl={group.repoUrl}
                  issueUrl={group.issueUrl}
                  julesUrl={group.julesUrl}
                  isHidden={hiddenIds.has(group.baseName)}
                  onToggleHide={toggleHide}
                />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
