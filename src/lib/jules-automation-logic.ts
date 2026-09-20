import { listAllJulesSources, createJulesSession, getRemainingSessionCapacity, JulesSource } from "./jules-client";
import {
  getRepoLastExecutedTimes,
  updateRepoLastExecutedTime,
  getHiddenRepos,
  getLastBatchExecutedTime,
  updateLastBatchExecutedTime,
  getJulesConfig,
  JulesSchedule,
} from "./firestore-client";
import { getRepoDefaultBranch, getAllReposInfo, GitHubRepoInfo } from "./github-client";

/**
 * Jules 自動化処理のオプション
 */
export interface JulesAutomationOptions {
  dryRun?: boolean;
  task?: string;
  limit?: number;
  ignoreCooldown?: boolean;
  ignoreSchedule?: boolean;
  julesApiKey: string;
  githubOwner: string;
}

/**
 * Jules 自動化処理の実行結果
 */
export interface JulesAutomationResult {
  message: string;
  sessionsCreated?: any[]; // 互換性維持用のプロパティ
  succeeded?: any[];
  failed?: any[];
  sessions?: any[];
  selectedRepos?: string[];
  dryRun: boolean;
  skipped?: boolean;
}

/**
 * 作成予定の Jules セッションリクエスト情報
 */
export interface SessionRequestPlan {
  source: string;
  title: string;
  prompt: string;
  taskType: "refactor";
  repo: string;
  startingBranch: string;
}

/**
 * 本日の曜日（JST基準）における必要残容量（しきい値）および自動起動が無効化されているかを判定します。
 */
export function getScheduleForToday(schedule?: JulesSchedule): { disabled: boolean; requiredCapacity: number; currentDay: string } {
  const currentDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(new Date()).toLowerCase() as keyof JulesSchedule;

  const dayVal = schedule ? schedule[currentDay] : 10;
  // dayVal > 15 または 16 の場合は OFF (無効)
  const requiredCapacity = typeof dayVal === "number" ? dayVal : 10;
  const disabled = requiredCapacity > 15;

  return { disabled, requiredCapacity, currentDay };
}

/**
 * 互換性のための非推奨ラッパー関数
 */
export function isScheduleDisabledForToday(schedule?: JulesSchedule): { disabled: boolean; currentDay: string } {
  const { disabled, currentDay } = getScheduleForToday(schedule);
  return { disabled, currentDay };
}

/**
 * Jules ソース一覧から自動化処理の対象となるリポジトリをフィルタリングします。
 */
export function filterTargetSources(
  sources: JulesSource[],
  activeReposMap: Map<string, GitHubRepoInfo>,
  hiddenReposList: string[],
  excludedReposList: string[]
): JulesSource[] {
  const activeReposSet = new Set(Array.from(activeReposMap.keys()).map((r) => r.toLowerCase()));
  const hiddenReposSet = new Set(hiddenReposList.map((r) => r.toLowerCase()));
  const excludedReposSet = new Set(excludedReposList.map((r) => r.toLowerCase()));

  return sources.filter((source) => {
    const repoName = source.githubRepo?.repo.toLowerCase() || "";
    if (!repoName || repoName === "_template") return false;
    if (hiddenReposSet.has(repoName)) return false;
    if (excludedReposSet.has(repoName)) return false;
    if (!activeReposSet.has(repoName)) return false;
    return true;
  });
}

/**
 * 対象ソースを最終実行日時の古い順（未実行が最優先）でソートします。
 */
export function sortSourcesByExecutionHistory(
  sources: JulesSource[],
  lastExecutedTimes: Record<string, Date>
): JulesSource[] {
  return [...sources].sort((a, b) => {
    const nameA = a.githubRepo?.repo || "";
    const nameB = b.githubRepo?.repo || "";

    const timeA = lastExecutedTimes[nameA] ? lastExecutedTimes[nameA].getTime() : 0;
    const timeB = lastExecutedTimes[nameB] ? lastExecutedTimes[nameB].getTime() : 0;

    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return nameA.localeCompare(nameB);
  });
}

/**
 * 選択されたソースに対してセッション作成計画を構築します。
 */
export async function buildSessionRequests(
  sources: JulesSource[],
  githubOwner: string
): Promise<SessionRequestPlan[]> {
  const plans: SessionRequestPlan[] = [];

  for (const source of sources) {
    const repoName = source.githubRepo?.repo || "";
    if (!repoName) continue;

    const startingBranch = await getRepoDefaultBranch(githubOwner, repoName);

    plans.push({
      source: source.name,
      title: `[Jules] Daily Refactoring for ${repoName}`,
      prompt: `Analyze this repository and perform general refactoring and documentation updates. This includes cleaning up unused code, simplifying complex functions, updating outdated patterns, optimizing performance, ensuring a clean and consistent coding style throughout the codebase, and updating or creating documentation (such as README.md, inline comments, or docs) to reflect current codebase status. Finally, prepare a Pull Request with your improvements.`,
      taskType: "refactor",
      repo: repoName,
      startingBranch,
    });
  }

  return plans;
}

/**
 * Jules API 呼び出しによるタスク自動化処理を実行します。
 *
 * @param options 自動化オプション
 * @returns 処理結果
 */
export async function executeJulesAutomation(
  options: JulesAutomationOptions
): Promise<JulesAutomationResult> {
  const { julesApiKey, githubOwner } = options;
  const dryRun = options.dryRun !== false;

  // 起動1回あたりの実行リポジトリ数制限（デフォルト1、範囲1〜3）
  const limit = Math.max(1, Math.min(3, options.limit ?? 1));

  // Jules Sources（リポジトリ一覧）の取得
  const allSources = await listAllJulesSources(julesApiKey);

  // 指定されたオーナーのリポジトリに絞り込み
  const ownerSources = allSources.filter(
    (source) => source.githubRepo?.owner.toLowerCase() === githubOwner.toLowerCase()
  );

  if (ownerSources.length === 0) {
    return {
      message: "No repositories found for the specified owner in Jules sources.",
      sessionsCreated: [],
      dryRun,
    };
  }

  // GitHub からアクティブなリポジトリ一覧を取得（Dependabot アラートは不要）
  const activeReposMap = await getAllReposInfo({ includeDependabotAlerts: false });

  // Jules 設定（曜日別起動設定・対象外リポジトリ）の取得
  const julesConfig = await getJulesConfig();

  // 曜日別起動スケジュール・必要残容量の判定（JST 基準）
  let requiredCapacity = 10;
  if (!options.ignoreSchedule) {
    const { disabled, requiredCapacity: reqCap, currentDay } = getScheduleForToday(julesConfig.schedule);
    requiredCapacity = reqCap;
    if (disabled) {
      console.log(`[Jules Automation] 本日 (${currentDay}) はスケジュール設定により自動起動が無効化されているため、処理をスキップします。`);
      return {
        message: `Jules automation skipped: execution is disabled for today (${currentDay}) in schedule configuration.`,
        succeeded: [],
        failed: [],
        dryRun,
        skipped: true,
      };
    }
  }

  // 非表示リポジトリを取得
  const hiddenReposList = await getHiddenRepos();

  // 対象ソースの抽出
  const targetSources = filterTargetSources(
    ownerSources,
    activeReposMap,
    hiddenReposList,
    julesConfig.excludedRepos || []
  );

  if (targetSources.length === 0) {
    return {
      message: "No target repositories found for the specified owner in Jules sources.",
      sessionsCreated: [],
      dryRun,
    };
  }

  // 最終実行履歴に基づくソートと制限数の切り出し
  const lastExecutedTimes = await getRepoLastExecutedTimes();
  const sortedTargetSources = sortSourcesByExecutionHistory(targetSources, lastExecutedTimes);
  const selectedSources = sortedTargetSources.slice(0, limit);

  // セッション作成計画の構築
  const sessionsToCreate = await buildSessionRequests(selectedSources, githubOwner);

  // Dry-run モードの処理
  if (dryRun) {
    console.log(`[Dry-run] Jules 自動化タスク候補 (${sessionsToCreate.length}件、対象リポジトリ: ${selectedSources.length}件):`);
    sessionsToCreate.forEach((session) => {
      console.log(`- [${session.taskType}] ${session.title} (Source: ${session.source})`);
    });

    return {
      message: `Dry-run completed. Simulated ${sessionsToCreate.length} Jules sessions for ${selectedSources.length} repositories.`,
      sessions: sessionsToCreate,
      selectedRepos: selectedSources.map((s) => s.githubRepo?.repo || ""),
      dryRun: true,
    };
  }

  // 24時間以内の残容量チェック（本日の曜日設定による必要残容量しきい値と比較）
  const remainingCapacity = await getRemainingSessionCapacity(julesApiKey);
  if (remainingCapacity < requiredCapacity) {
    console.log(`[Jules Automation] 直近24時間の残りセッション作成可能数 (${remainingCapacity}) が必要残容量 (${requiredCapacity}) 未満のため、バッチ処理をスキップします。`);
    return {
      message: `Jules automation skipped: insufficient session capacity (${remainingCapacity} remaining, minimum required is ${requiredCapacity}).`,
      succeeded: [],
      failed: [],
      dryRun: false,
      skipped: true,
    };
  }

  // クールダウン（二重起動防止）チェック
  if (!options.ignoreCooldown) {
    const lastBatchTime = await getLastBatchExecutedTime();
    const cooldownMs = 10 * 60 * 1000; // 10分
    if (lastBatchTime && Date.now() - lastBatchTime.getTime() < cooldownMs) {
      console.log(`[Jules Automation] 直近10分以内にバッチ処理が実行されているため、二重起動を防止し処理をスキップします。 (前回実行: ${lastBatchTime.toISOString()})`);
      return {
        message: "Jules automation skipped: executed recently within cooldown window (10 minutes).",
        succeeded: [],
        failed: [],
        dryRun: false,
        skipped: true,
      };
    }
  }

  // 実行開始時に最終バッチ実行日時を更新
  await updateLastBatchExecutedTime();

  console.log(`Jules API を使用して、${sessionsToCreate.length}件のセッションの作成を開始します。`);
  const results = await Promise.allSettled(
    sessionsToCreate.map(async (session) => {
      console.log(`セッションを作成中: [${session.taskType}] ${session.title} (Repo: ${session.repo}, Source: ${session.source})`);
      try {
        const res = await createJulesSession(julesApiKey, {
          prompt: session.prompt,
          sourceContext: {
            source: session.source,
            githubRepoContext: {
              startingBranch: session.startingBranch,
            },
          },
          automationMode: "AUTO_CREATE_PR",
          title: session.title,
        });
        return {
          sessionName: res.name,
          sessionId: res.id,
          title: res.title,
          repo: session.repo,
          taskType: session.taskType,
        };
      } catch (err: any) {
        console.error(`セッション作成失敗 [${session.taskType}] (${session.title}):`, err?.message || err);
        throw err;
      }
    })
  );

  const succeeded = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason?.message || String(r.reason));

  if (failed.length > 0) {
    console.error(`Jules セッション作成でエラーが発生した件数: ${failed.length}件`);
    failed.forEach((err, idx) => {
      console.error(`- 失敗詳細 [${idx + 1}]: ${err}`);
    });
  }

  // 成功したセッションに関連する子リポジトリの最終実行日時を更新
  const succeededRepos = new Set<string>();
  succeeded.forEach((session) => {
    if (session.repo) {
      succeededRepos.add(session.repo);
    }
  });

  for (const repo of succeededRepos) {
    await updateRepoLastExecutedTime(repo);
  }

  console.log(`Jules セッション作成完了。成功: ${succeeded.length}, 失敗: ${failed.length}`);

  return {
    message: `Jules automation completed. Succeeded: ${succeeded.length}, Failed: ${failed.length}`,
    succeeded,
    failed,
    dryRun: false,
  };
}
