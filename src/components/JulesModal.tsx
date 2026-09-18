"use client";

import React, { useState, useEffect } from "react";
import { Zap, Play, Settings, Save, Loader2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ServiceGroup } from "@/lib/types";
import { JulesSchedule } from "@/lib/firestore-client";

interface JulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceGroups: ServiceGroup[];
  hiddenIds: Set<string>;
}

export const JulesModal: React.FC<JulesModalProps> = ({
  isOpen,
  onClose,
  serviceGroups,
  hiddenIds,
}) => {
  const [julesActiveTab, setJulesActiveTab] = useState<"run" | "config">("run");
  const [julesLimit, setJulesLimit] = useState(1);
  const [julesTask, setJulesTask] = useState("refactor");
  const [isExecutingJules, setIsExecutingJules] = useState(false);
  const [julesResult, setJulesResult] = useState<any | null>(null);
  const [julesError, setJulesError] = useState<string | null>(null);

  // Jules 設定（曜日別スケジュール & 対象外リポジトリ）用のステート
  const [julesSchedule, setJulesSchedule] = useState<JulesSchedule>({
    sun: true,
    mon: true,
    tue: true,
    wed: true,
    thu: true,
    fri: true,
    sat: true,
  });
  const [excludedRepos, setExcludedRepos] = useState<Set<string>>(new Set());
  const [isLoadingJulesConfig, setIsLoadingJulesConfig] = useState(false);
  const [isSavingJulesConfig, setIsSavingJulesConfig] = useState(false);
  const [julesConfigSaveSuccess, setJulesConfigSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setJulesResult(null);
      setJulesError(null);
      fetchJulesConfig();
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-lg p-6 relative flex flex-col max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
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
                onClick={onClose}
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
                    onClick={onClose}
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
  );
};
