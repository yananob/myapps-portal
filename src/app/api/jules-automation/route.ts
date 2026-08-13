import { NextRequest, NextResponse } from "next/server";
import { listAllJulesSources, createJulesSession } from "@/lib/jules-client";
import { getRepoLastExecutedTimes, updateRepoLastExecutedTime } from "@/lib/firestore-client";

/**
 * Jules API 呼び出しによるタスク自動化エンドポイント
 *
 * すべてのコードコメントは、AGENTS.mdの指示に基づき日本語で記述されています。
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 認証チェック
    const authHeader = request.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Jules API キー & GITHUB_OWNER の確認
    const julesApiKey = process.env.JULES_API_KEY;
    const githubOwner = process.env.GITHUB_OWNER;

    if (!julesApiKey) {
      return NextResponse.json({ error: "JULES_API_KEY is not set" }, { status: 500 });
    }
    if (!githubOwner) {
      return NextResponse.json({ error: "GITHUB_OWNER is not set" }, { status: 500 });
    }

    // 3. リクエストボディおよびPub/Sub等のイベントデータのパース
    let body: any = null;
    try {
      const text = await request.clone().text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // ボディがない、またはパースエラーの場合は無視します
    }

    // dryRunオプション、taskオプション、limitオプションのパース
    let bodyDryRun: boolean | null = null;
    let bodyTask: string | null = null;
    let bodyLimit: number | null = null;

    if (body) {
      if (typeof body.dryRun !== "undefined") {
        bodyDryRun = body.dryRun === true || body.dryRun === "true";
      }
      if (typeof body.task !== "undefined") {
        bodyTask = body.task;
      }
      if (typeof body.limit !== "undefined") {
        bodyLimit = Number(body.limit);
      }

      // Pub/Subメッセージのデータをデコードして確認
      if (body.message?.data) {
        try {
          const decodedData = Buffer.from(body.message.data, "base64").toString("utf-8");
          const parsedData = JSON.parse(decodedData);
          if (parsedData) {
            if (typeof parsedData.dryRun !== "undefined") {
              bodyDryRun = parsedData.dryRun === true || parsedData.dryRun === "true";
            }
            if (parsedData.task) {
              bodyTask = parsedData.task;
            }
            if (typeof parsedData.limit !== "undefined") {
              bodyLimit = Number(parsedData.limit);
            }
          }
        } catch (e) {
          // デコード/パースエラーは無視
        }
      }
    }

    const urlString = request.url || "http://localhost/api/jules-automation";
    const { searchParams } = new URL(urlString);

    // クエリパラメータの読み込み
    const dryRunQuery = searchParams.get("dryRun");
    const taskQuery = searchParams.get("task");
    const limitQuery = searchParams.get("limit");

    // デフォルトは安全のため dryRun = true
    let dryRun = true;
    if (dryRunQuery !== null) {
      dryRun = dryRunQuery !== "false";
    } else if (bodyDryRun !== null) {
      dryRun = bodyDryRun;
    }

    const task = taskQuery || bodyTask || "all";

    // 起動1回あたりの実行リポジトリ数制限（デフォルト3、範囲1〜3）
    let limit = 3;
    const rawLimit = limitQuery !== null ? Number(limitQuery) : bodyLimit;
    if (rawLimit !== null && !isNaN(rawLimit)) {
      limit = Math.max(1, Math.min(3, rawLimit));
    }

    // 4. Jules Sources（リポジトリ一覧）の取得
    const allSources = await listAllJulesSources(julesApiKey);

    // 指定されたオーナーのリポジトリに絞り込む
    const ownerSources = allSources.filter(
      (source) =>
        source.githubRepo?.owner.toLowerCase() === githubOwner.toLowerCase()
    );

    if (ownerSources.length === 0) {
      return NextResponse.json({
        message: "No repositories found for the specified owner in Jules sources.",
        sessionsCreated: [],
        dryRun,
      });
    }

    // テンプレートリポジトリ（_template）と、それ以外の子リポジトリに分ける
    const templateSource = ownerSources.find(
      (source) => source.githubRepo?.repo.toLowerCase() === "_template"
    );

    const childSources = ownerSources.filter(
      (source) => source.githubRepo?.repo.toLowerCase() !== "_template"
    );

    if (childSources.length === 0) {
      return NextResponse.json({
        message: "No child repositories found for the specified owner in Jules sources.",
        sessionsCreated: [],
        dryRun,
      });
    }

    // 5. Firestore から最終実行日時履歴を取得し、ソートして実行対象リポジトリを選択
    const lastExecutedTimes = await getRepoLastExecutedTimes();

    const sortedChildSources = [...childSources].sort((a, b) => {
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
    const selectedChildSources = sortedChildSources.slice(0, limit);

    // セッション作成のためのリクエスト計画リスト
    const sessionsToCreate: {
      source: string;
      title: string;
      prompt: string;
      taskType: "template-sync" | "refactor";
      repo: string;
    }[] = [];

    // --- タスク 1: template 更新の計画 ---
    if (task === "template" || task === "all") {
      if (!templateSource) {
        console.warn("Jules ソース内にテンプレートリポジトリ '_template' が見つからなかったため、タスク1をスキップします。");
      } else {
        for (const child of selectedChildSources) {
          const repoName = child.githubRepo?.repo || "";
          if (!repoName) continue;

          // 子リポジトリの更新内容を _template へ反映する PR を作る計画 (Session in _template)
          sessionsToCreate.push({
            source: templateSource.name,
            title: `[Jules] Sync updates from ${repoName} to _template`,
            prompt: `Compare this template repository with the child/derived repository ${githubOwner}/${repoName}. Identify any generic updates, bug fixes, performance improvements, or modern configuration changes made in ${repoName} that should be brought back to this base template. Apply those changes to this template repository, keeping them generic and modular, and prepare a Pull Request.`,
            taskType: "template-sync",
            repo: repoName,
          });

          // _template で更新した内容を各子リポジトリへ反映する PR を作る計画 (Session in Child Repo)
          sessionsToCreate.push({
            source: child.name,
            title: `[Jules] Sync updates from _template to ${repoName}`,
            prompt: `Compare this repository with the upstream template repository ${githubOwner}/_template. Identify any missing updates, modern dependencies, configs, helper utilities, or standardizations present in ${githubOwner}/_template. Apply those template changes to this repository and prepare a Pull Request.`,
            taskType: "template-sync",
            repo: repoName,
          });
        }
      }
    }

    // --- タスク 2: リファクタリングの計画 ---
    if (task === "refactor" || task === "all") {
      for (const child of selectedChildSources) {
        const repoName = child.githubRepo?.repo || "";
        if (!repoName) continue;

        sessionsToCreate.push({
          source: child.name,
          title: `[Jules] Daily Refactoring for ${repoName}`,
          prompt: `Analyze this repository and perform general refactoring. This includes cleaning up unused code, simplifying complex functions, updating outdated patterns, optimizing performance, and ensuring a clean and consistent coding style throughout the codebase. Finally, prepare a Pull Request with your improvements.`,
          taskType: "refactor",
          repo: repoName,
        });
      }
    }

    // 6. Dry-run もしくは 実際の API 呼び出しの実行
    if (dryRun) {
      console.log(`[Dry-run] Jules 自動化タスク候補 (${sessionsToCreate.length}件、対象リポジトリ: ${selectedChildSources.length}件):`);
      sessionsToCreate.forEach((session) => {
        console.log(`- [${session.taskType}] ${session.title} (Source: ${session.source})`);
      });

      return NextResponse.json({
        message: `Dry-run completed. Simulated ${sessionsToCreate.length} Jules sessions for ${selectedChildSources.length} repositories.`,
        sessions: sessionsToCreate,
        selectedRepos: selectedChildSources.map((s) => s.githubRepo?.repo),
        dryRun: true,
      });
    }

    console.log(`Jules API を使用して、${sessionsToCreate.length}件のセッションの作成を開始します。`);
    const results = await Promise.allSettled(
      sessionsToCreate.map(async (session) => {
        console.log(`セッションを作成中: ${session.title}`);
        const res = await createJulesSession(julesApiKey, {
          prompt: session.prompt,
          sourceContext: {
            source: session.source,
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
      })
    );

    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map((r) => r.value);

    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason?.message || String(r.reason));

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

    return NextResponse.json({
      message: `Jules automation completed. Succeeded: ${succeeded.length}, Failed: ${failed.length}`,
      succeeded,
      failed,
      dryRun: false,
    });

  } catch (error: any) {
    console.error("Jules automation API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
