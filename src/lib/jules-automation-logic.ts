import { listAllJulesSources, createJulesSession } from "./jules-client";
import {
  getRepoLastExecutedTimes,
  updateRepoLastExecutedTime,
  getHiddenRepos,
  getLastBatchExecutedTime,
  updateLastBatchExecutedTime,
} from "./firestore-client";
import { getRepoDefaultBranch } from "./github-client";

/**
 * Jules 自動化処理のオプション
 */
export interface JulesAutomationOptions {
  dryRun?: boolean;
  task?: string;
  limit?: number;
  ignoreCooldown?: boolean;
  julesApiKey: string;
  githubOwner: string;
}

/**
 * Jules 自動化処理の結果
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
 * Jules API 呼び出しによるタスク自動化処理を実行します。
 *
 * @param options 自動化オプション
 * @returns 処理結果
 */
export async function executeJulesAutomation(
  options: JulesAutomationOptions
): Promise<JulesAutomationResult> {
  const { julesApiKey, githubOwner } = options;
  const dryRun = options.dryRun !== false; // デフォルトは安全のため true
  const task = options.task || "all";

  // 起動1回あたりの実行リポジトリ数制限（デフォルト1、範囲1〜3）
  let limit = 1;
  if (options.limit !== undefined && options.limit !== null && !isNaN(options.limit)) {
    limit = Math.max(1, Math.min(3, options.limit));
  }

  // Jules Sources（リポジトリ一覧）の取得
  const allSources = await listAllJulesSources(julesApiKey);

  // 指定されたオーナーのリポジトリに絞り込む
  const ownerSources = allSources.filter(
    (source) =>
      source.githubRepo?.owner.toLowerCase() === githubOwner.toLowerCase()
  );

  if (ownerSources.length === 0) {
    return {
      message: "No repositories found for the specified owner in Jules sources.",
      sessionsCreated: [],
      dryRun,
    };
  }

  // Firestore から非表示リポジトリを取得し、除外対象を判定
  const hiddenReposList = await getHiddenRepos();
  const hiddenReposSet = new Set(hiddenReposList.map((r) => r.toLowerCase()));

  // テンプレートリポジトリ（_template）および非表示リポジトリを自動リファクタリングの対象から除外
  const targetSources = ownerSources.filter((source) => {
    const repoName = source.githubRepo?.repo.toLowerCase() || "";
    if (repoName === "_template") return false;
    if (hiddenReposSet.has(repoName)) return false;
    return true;
  });

  if (targetSources.length === 0) {
    return {
      message: "No target repositories found for the specified owner in Jules sources.",
      sessionsCreated: [],
      dryRun,
    };
  }

  // Firestore から最終実行日時履歴を取得し、ソートして実行対象リポジトリを選択
  const lastExecutedTimes = await getRepoLastExecutedTimes();

  const sortedTargetSources = [...targetSources].sort((a, b) => {
    const nameA = a.githubRepo?.repo || "";
    const nameB = b.githubRepo?.repo || "";

    const timeA = lastExecutedTimes[nameA] ? lastExecutedTimes[nameA].getTime() : 0;
    const timeB = lastExecutedTimes[nameB] ? lastExecutedTimes[nameB].getTime() : 0;

    if (timeA !== timeB) {
      return timeA - timeB; // 最終実行日時が古い順（未実行=0が最優先）
    }
    return nameA.localeCompare(nameB); // 日時が同じ場合は辞書順で安定ソート
  });

  // 制限（1〜3）に基づいてターゲットリポジトリをスライス
  const selectedTargetSources = sortedTargetSources.slice(0, limit);

  // セッション作成のためのリクエスト計画リスト（リファクタリングのみ）
  const sessionsToCreate: {
    source: string;
    title: string;
    prompt: string;
    taskType: "refactor";
    repo: string;
    startingBranch: string;
  }[] = [];

  // --- リファクタリングの計画 ---
  for (const target of selectedTargetSources) {
    const repoName = target.githubRepo?.repo || "";
    if (!repoName) continue;

    const startingBranch = await getRepoDefaultBranch(githubOwner, repoName);

    sessionsToCreate.push({
      source: target.name,
      title: `[Jules] Daily Refactoring for ${repoName}`,
      prompt: `Analyze this repository and perform general refactoring and documentation updates. This includes cleaning up unused code, simplifying complex functions, updating outdated patterns, optimizing performance, ensuring a clean and consistent coding style throughout the codebase, and updating or creating documentation (such as README.md, inline comments, or docs) to reflect current codebase status. Finally, prepare a Pull Request with your improvements.`,
      taskType: "refactor",
      repo: repoName,
      startingBranch,
    });
  }

  // Dry-run もしくは 実際の API 呼び出しの実行
  if (dryRun) {
    console.log(`[Dry-run] Jules 自動化タスク候補 (${sessionsToCreate.length}件、対象リポジトリ: ${selectedTargetSources.length}件):`);
    sessionsToCreate.forEach((session) => {
      console.log(`- [${session.taskType}] ${session.title} (Source: ${session.source})`);
    });

    return {
      message: `Dry-run completed. Simulated ${sessionsToCreate.length} Jules sessions for ${selectedTargetSources.length} repositories.`,
      sessions: sessionsToCreate,
      selectedRepos: selectedTargetSources.map((s) => s.githubRepo?.repo || ""),
      dryRun: true,
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

  // 成功したセッションに関連する子リポジトリの一覧を特定し、Firestore を更新
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
