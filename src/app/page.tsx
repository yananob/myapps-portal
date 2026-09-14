"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Loader2, RefreshCw, AlertCircle, X, Eye, EyeOff, ShieldAlert, Zap, Play, Settings, Save, Check } from "lucide-react";
import { ServiceCard } from "@/components/ServiceCard";
import { cn } from "@/lib/utils";
import { ServiceGroup } from "@/lib/types";
import { JulesSchedule } from "@/lib/firestore-client";

export default function Dashboard() {
  const [serviceGroups, setServiceGroups] = useState<ServiceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [filterDependabotOnly, setFilterDependabotOnly] = useState(false);

  // Jules 自動化ダイアログ用のステート
  const [isJulesModalOpen, setIsJulesModalOpen] = useState(false);
  const [julesActiveTab, setJulesActiveTab] = useState<"run" | "config">("run");
  const [julesLimit, setJulesLimit] = useState(1);
  const [julesTask, setJulesTask] = useState("refactor");
  const [isExecutingJules, setIsExecutingJules] = useState(false);
  const [julesResult, setJulesResult] = useState<any | null>(null);
  const [julesError, setJulesError] = useState<string | null>(null);

  // Jules 設定（曜日別スケジュール & 対象外リポジトリ）用のステート
  const [julesSchedule, setJulesSchedule] = useState<JulesSchedule>({
    sun: true, mon: true, tue: true, wed: true, thu: true, fri: true, sat: true,
  });
  const [excludedRepos, setExcludedRepos] = useState<Set<string>>(new Set());
  const [isLoadingJulesConfig, setIsLoadingJulesConfig] = useState(false);
  const [isSavingJulesConfig, setIsSavingJulesConfig] = useState(false);
  const [julesConfigSaveSuccess, setJulesConfigSaveSuccess] = useState(false);

  const fetchJulesConfig = async () => {
    setIsLoadingJulesConfig(true);
    try {
      const response = await fetch("/api/jules-config");
      const data = await response.json();
      if (response.ok) {
        if (data.schedule) {
          setJulesSchedule(data.schedule);
        }
        if (Array.isArray(data.excludedRepos)) {
          setExcludedRepos(new Set(data.excludedRepos));
        }
      }
    } catch (e) {
      console.error("Failed to fetch Jules config:", e);
    } finally {
      setIsLoadingJulesConfig(false);
    }
  };

  const handleSaveJulesConfig = async () => {
    setIsSavingJulesConfig(true);
    setJulesConfigSaveSuccess(false);
    setJulesError(null);
    try {
      const response = await fetch("/api/jules-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule: julesSchedule,
          excludedRepos: Array.from(excludedRepos),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setJulesConfigSaveSuccess(true);
        setTimeout(() => setJulesConfigSaveSuccess(false), 3000);
      } else {
        setJulesError(data.error || "設定の保存に失敗しました");
      }
    } catch (err: any) {
      console.error("Failed to save Jules config:", err);
      setJulesError(err instanceof Error ? err.message : "予期せぬエラーが発生しました");
    } finally {
      setIsSavingJulesConfig(false);
    }
  };

  const handleExecuteJules = async () => {
    setIsExecutingJules(true);
    setJulesError(null);
    setJulesResult(null);

    try {
      const response = await fetch("/api/jules-automation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dryRun: false,
          limit: julesLimit,
          task: julesTask,
          ignoreCooldown: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setJulesError(data.error || "Jules 自動化の実行に失敗しました");
      } else {
        setJulesResult(data);
      }
    } catch (err: any) {
      console.error("Failed to execute Jules automation:", err);
      setJulesError(err instanceof Error ? err.message : "予期せぬエラーが発生しました");
    } finally {
      setIsExecutingJules(false);
    }
  };

  const CACHE_KEY = "myapps-portal-cache";
  const CACHE_TIME_KEY = "myapps-portal-cache-time";

  const fetchHiddenRepos = async () => {
    try {
      const response = await fetch("/api/hidden-repos");
      const data = await response.json();
      if (response.ok && Array.isArray(data.hiddenRepos)) {
        setHiddenIds(new Set(data.hiddenRepos));
      }
    } catch (e) {
      console.error("Failed to fetch hidden repos:", e);
    }
  };

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
    fetchHiddenRepos();
  }, []);

  const toggleHide = async (baseName: string) => {
    const isCurrentlyHidden = hiddenIds.has(baseName);
    const newHiddenState = !isCurrentlyHidden;

    // 楽観的UI更新
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (newHiddenState) {
        next.add(baseName);
      } else {
        next.delete(baseName);
      }
      return next;
    });

    try {
      const response = await fetch("/api/hidden-repos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: baseName,
          hidden: newHiddenState,
        }),
      });
      if (!response.ok) {
        console.error("Failed to update hidden status on server");
        // エラーが発生した場合はロールバック
        setHiddenIds((prev) => {
          const next = new Set(prev);
          if (isCurrentlyHidden) {
            next.add(baseName);
          } else {
            next.delete(baseName);
          }
          return next;
        });
      }
    } catch (e) {
      console.error("Failed to toggle hidden repo status:", e);
      // ロールバック
      setHiddenIds((prev) => {
        const next = new Set(prev);
        if (isCurrentlyHidden) {
          next.add(baseName);
        } else {
          next.delete(baseName);
        }
        return next;
      });
    }
  };

  const filteredGroups = useMemo(() => {
    return serviceGroups
      .filter((group) =>
        group.baseName.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .filter((group) => showHidden || !hiddenIds.has(group.baseName))
      .filter((group) => !filterDependabotOnly || Boolean(group.hasDependabotAlerts))
      .sort((a, b) => {
        // 非表示のものを下に持ってくる
        const aHidden = hiddenIds.has(a.baseName);
        const bHidden = hiddenIds.has(b.baseName);
        if (aHidden && !bHidden) return 1;
        if (!aHidden && bHidden) return -1;
        return 0;
      });
  }, [serviceGroups, searchQuery, hiddenIds, showHidden, filterDependabotOnly]);

  return (
    <main className="container mx-auto px-4 py-8 max-w-7xl">
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            MyApps Manager
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
              onClick={() => setFilterDependabotOnly(!filterDependabotOnly)}
              className={cn(
                "p-2 transition-colors rounded-md flex items-center gap-1",
                filterDependabotOnly
                  ? "text-amber-600 bg-amber-50 dark:bg-amber-900/30"
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              )}
              title={filterDependabotOnly ? "すべてのアイテムを表示" : "Dependabot アラートありのみ表示"}
            >
              <ShieldAlert className="w-5 h-5" />
            </button>
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
            <button
              onClick={() => {
                setJulesResult(null);
                setJulesError(null);
                fetchJulesConfig();
                setIsJulesModalOpen(true);
              }}
              className="ml-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 shadow-sm shrink-0"
              title="Jules Automation を画面から起動・設定"
            >
              <Zap className="w-4 h-4 fill-white" />
              <span>Jules</span>
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

      {/* Jules Automation Modal */}
      {isJulesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-lg p-6 relative flex flex-col max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsJulesModalOpen(false)}
              disabled={isExecutingJules}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-6 h-6 text-amber-500 fill-amber-500" />
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                Jules Automation
              </h2>
            </div>

            {/* タブ切り替え */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 mb-4">
              <button
                type="button"
                onClick={() => setJulesActiveTab("run")}
                className={cn(
                  "px-4 py-2 font-medium text-sm transition-colors border-b-2 flex items-center gap-1.5",
                  julesActiveTab === "run"
                    ? "border-amber-500 text-amber-600 dark:text-amber-400"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                <Play className="w-4 h-4" />
                <span>手動実行</span>
              </button>
              <button
                type="button"
                onClick={() => setJulesActiveTab("config")}
                className={cn(
                  "px-4 py-2 font-medium text-sm transition-colors border-b-2 flex items-center gap-1.5",
                  julesActiveTab === "config"
                    ? "border-amber-500 text-amber-600 dark:text-amber-400"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                <Settings className="w-4 h-4" />
                <span>起動・除外設定</span>
              </button>
            </div>

            {julesActiveTab === "run" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleExecuteJules();
                }}
                className="space-y-4"
              >
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Jules の使用回数が余っている場合に、AI によるリポジトリの自動リファクタリングタスク（PR作成）を画面から即時起動できます。
                </p>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    対象リポジトリ数 (Limit: 1~3)
                  </label>
                  <select
                    value={julesLimit}
                    onChange={(e) => setJulesLimit(Number(e.target.value))}
                    disabled={isExecutingJules}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value={1}>1 リポジトリ</option>
                    <option value={2}>2 リポジトリ</option>
                    <option value={3}>3 リポジトリ</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    タスク種別
                  </label>
                  <input
                    type="text"
                    value={julesTask}
                    onChange={(e) => setJulesTask(e.target.value)}
                    disabled={isExecutingJules}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                    placeholder="refactor"
                  />
                </div>

                {julesError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-700 dark:text-red-300">
                    {julesError}
                  </div>
                )}

                {julesResult && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2 text-xs text-slate-800 dark:text-slate-200">
                    <p className="font-semibold text-sm text-slate-900 dark:text-white mb-1">
                      {julesResult.message}
                    </p>
                    {julesResult.selectedRepos && julesResult.selectedRepos.length > 0 && (
                      <div>
                        <span className="font-medium">対象リポジトリ:</span>{" "}
                        {julesResult.selectedRepos.join(", ")}
                      </div>
                    )}
                    {julesResult.sessions && julesResult.sessions.length > 0 && (
                      <div className="space-y-1 mt-2">
                        <span className="font-medium">作成予定セッション:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400 pl-1">
                          {julesResult.sessions.map((s: any, idx: number) => (
                            <li key={idx}>
                              {s.title} ({s.repo})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {julesResult.succeeded && julesResult.succeeded.length > 0 && (
                      <div className="space-y-1 mt-2">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">作成成功セッション:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400 pl-1">
                          {julesResult.succeeded.map((s: any, idx: number) => (
                            <li key={idx}>
                              {s.title} ({s.repo})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {julesResult.failed && julesResult.failed.length > 0 && (
                      <div className="space-y-1 mt-2">
                        <span className="font-medium text-red-600 dark:text-red-400">失敗詳細:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-red-600 dark:text-red-400 pl-1">
                          {julesResult.failed.map((f: string, idx: number) => (
                            <li key={idx}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsJulesModalOpen(false)}
                    disabled={isExecutingJules}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                  >
                    閉じる
                  </button>
                  <button
                    type="submit"
                    disabled={isExecutingJules}
                    className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                  >
                    {isExecutingJules ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>実行中...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-white" />
                        <span>Jules を実行</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-5">
                {isLoadingJulesConfig ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-amber-500 animate-spin mb-2" />
                    <p className="text-xs text-slate-500">設定を読み込み中...</p>
                  </div>
                ) : (
                  <>
                    {/* 曜日別自動起動設定 */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        曜日別自動起動スケジュール（JST）
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        Cron等による定期実行時に、自動起動を許可する曜日を選択してください。
                      </p>
                      <div className="grid grid-cols-7 gap-1">
                        {[
                          { key: "sun", label: "日" },
                          { key: "mon", label: "月" },
                          { key: "tue", label: "火" },
                          { key: "wed", label: "水" },
                          { key: "thu", label: "木" },
                          { key: "fri", label: "金" },
                          { key: "sat", label: "土" },
                        ].map(({ key, label }) => {
                          const dayKey = key as keyof JulesSchedule;
                          const isChecked = julesSchedule[dayKey];
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                setJulesSchedule((prev) => ({
                                  ...prev,
                                  [dayKey]: !prev[dayKey],
                                }));
                              }}
                              className={cn(
                                "py-2 text-xs font-semibold rounded-lg border transition-all flex flex-col items-center gap-1",
                                isChecked
                                  ? "bg-amber-500 border-amber-600 text-white shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500"
                              )}
                            >
                              <span>{label}</span>
                              <span className="text-[10px] font-normal opacity-90">
                                {isChecked ? "ON" : "OFF"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Jules 処理対象外リポジトリの設定 */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Jules 処理対象外リポジトリ
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        メイン画面に表示されているリポジトリの中から、Jules の自動リファクタリング対象から除外するリポジトリを選択してください。（※非表示にしたリポジトリやアーカイブのリポジトリは自動的に対象外となります）
                      </p>
                      <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg p-2 space-y-1 bg-slate-50 dark:bg-slate-800/50">
                        {serviceGroups.filter((group) => !hiddenIds.has(group.baseName)).length === 0 ? (
                          <p className="text-xs text-slate-400 py-2 text-center">
                            対象となるリポジトリがありません
                          </p>
                        ) : (
                          serviceGroups
                            .filter((group) => !hiddenIds.has(group.baseName))
                            .map((group) => {
                              const isExcluded = excludedRepos.has(group.baseName);
                              return (
                                <label
                                  key={group.baseName}
                                  className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-slate-200/50 dark:hover:bg-slate-800 rounded text-xs text-slate-800 dark:text-slate-200 cursor-pointer select-none"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isExcluded}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setExcludedRepos((prev) => {
                                        const next = new Set(prev);
                                        if (checked) {
                                          next.add(group.baseName);
                                        } else {
                                          next.delete(group.baseName);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 dark:border-slate-700"
                                  />
                                  <span className={cn(isExcluded && "line-through text-slate-400")}>
                                    {group.baseName}
                                  </span>
                                </label>
                              );
                            })
                        )}
                      </div>
                    </div>

                    {julesError && (
                      <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-700 dark:text-red-300">
                        {julesError}
                      </div>
                    )}

                    {julesConfigSaveSuccess && (
                      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Jules の起動・対象外設定を保存しました。</span>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setIsJulesModalOpen(false)}
                        disabled={isSavingJulesConfig}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                      >
                        閉じる
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveJulesConfig}
                        disabled={isSavingJulesConfig}
                        className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                      >
                        {isSavingJulesConfig ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>保存中...</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            <span>設定を保存</span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
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
                  hasDependabotAlerts={group.hasDependabotAlerts}
                  dependabotAlertsCount={group.dependabotAlertsCount}
                  dependabotUrl={group.dependabotUrl}
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
