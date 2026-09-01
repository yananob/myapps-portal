import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listAllJulesSources,
  listAllJulesSessions,
  getRemainingSessionCapacity,
  createJulesSession,
} from "@/lib/jules-client";
import { getRepoLastExecutedTimes, updateRepoLastExecutedTime, getRootCollectionName, getHiddenRepos } from "@/lib/firestore-client";
import { getRepoDefaultBranch } from "@/lib/github-client";
import { POST } from "@/app/api/jules-automation/route";
import { NextRequest } from "next/server";

// Jules APIクライアントの依存モジュールをモック（実体のgetRemainingSessionCapacityはそのまま使うようにactualをインポート）
vi.mock("@/lib/jules-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jules-client")>("@/lib/jules-client");
  return {
    ...actual,
    listAllJulesSources: vi.fn(),
    listAllJulesSessions: vi.fn(),
    createJulesSession: vi.fn(),
  };
});

// GitHubクライアントの依存モジュールをモック
vi.mock("@/lib/github-client", () => ({
  getRepoDefaultBranch: vi.fn(),
}));

// Firestoreクライアントの依存モジュールをモック
vi.mock("@/lib/firestore-client", () => ({
  getRepoLastExecutedTimes: vi.fn(),
  updateRepoLastExecutedTime: vi.fn(),
  getHiddenRepos: vi.fn(),
  getRootCollectionName: () => {
    const appEnv = process.env.APP_ENV;
    if (appEnv === "test") {
      return "myapps-portal-test";
    }
    return "myapps-portal";
  },
}));

describe("getRootCollectionName のテスト", () => {
  const originalEnv = process.env.APP_ENV;

  afterEach(() => {
    process.env.APP_ENV = originalEnv;
  });

  it("APP_ENVがtestの場合は myapps-portal-test を返却すること", () => {
    process.env.APP_ENV = "test";
    expect(getRootCollectionName()).toBe("myapps-portal-test");
  });

  it("APP_ENVがtest以外（例: production）の場合は myapps-portal を返却すること", () => {
    process.env.APP_ENV = "production";
    expect(getRootCollectionName()).toBe("myapps-portal");
  });
});

describe("Jules Automation API エンドポイントのテスト", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.JULES_API_KEY = "test-jules-key";
    process.env.GITHUB_OWNER = "test-owner";

    // FirestoreおよびGitHubのデフォルトモック
    vi.mocked(getRepoLastExecutedTimes).mockResolvedValue({});
    vi.mocked(updateRepoLastExecutedTime).mockResolvedValue(undefined);
    vi.mocked(getHiddenRepos).mockResolvedValue([]);
    vi.mocked(getRepoDefaultBranch).mockResolvedValue("test");
    // デフォルトでは過去24時間以内のセッションは0件（残り15件作成可能）
    vi.mocked(listAllJulesSessions).mockResolvedValue([]);
  });

  const createRequest = (
    authHeader?: string,
    url?: string,
    bodyObj?: any
  ) => {
    const headersMap = new Map<string, string | null>([
      ["Authorization", authHeader || null],
    ]);

    return {
      url: url || "http://localhost/api/jules-automation",
      headers: {
        get: (name: string) => headersMap.get(name) || null,
      },
      clone: () => ({
        text: async () => (bodyObj ? JSON.stringify(bodyObj) : ""),
      }),
    } as unknown as NextRequest;
  };

  it("認証に失敗した場合は 401 Unauthorized エラーを返却すること", async () => {
    const request = createRequest("Bearer wrong-secret");
    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("JULES_API_KEY が設定されていない場合は 500 エラーを返却すること", async () => {
    delete process.env.JULES_API_KEY;
    const request = createRequest("Bearer test-cron-secret");
    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("JULES_API_KEY is not set");
  });

  it("GITHUB_OWNER が設定されていない場合は 500 エラーを返却すること", async () => {
    delete process.env.GITHUB_OWNER;
    const request = createRequest("Bearer test-cron-secret");
    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("GITHUB_OWNER is not set");
  });

  it("リポジトリが見つからない場合は正常終了すること", async () => {
    vi.mocked(listAllJulesSources).mockResolvedValue([]);
    const request = createRequest("Bearer test-cron-secret");
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("No repositories found for the specified owner in Jules sources.");
  });

  it("Dry-run モードでリファクタリングタスクがシミュレートされ、デフォルトの制限(1個)で実行されること", async () => {
    // モックのJulesソースを用意
    const mockSources = [
      {
        name: "sources/github/test-owner/_template",
        id: "github/test-owner/_template",
        githubRepo: { owner: "test-owner", repo: "_template" },
      },
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
      {
        name: "sources/github/test-owner/app-two",
        id: "github/test-owner/app-two",
        githubRepo: { owner: "test-owner", repo: "app-two" },
      },
      {
        name: "sources/github/test-owner/app-three",
        id: "github/test-owner/app-three",
        githubRepo: { owner: "test-owner", repo: "app-three" },
      },
      {
        name: "sources/github/test-owner/app-four",
        id: "github/test-owner/app-four",
        githubRepo: { owner: "test-owner", repo: "app-four" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // limitパラメータなし => デフォルト1
    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dryRun).toBe(true);
    expect(body.selectedRepos).toHaveLength(1); // デフォルトで1つのリポジトリに制限される
    expect(body.selectedRepos).toEqual(["app-four"]); // 履歴なしの場合は辞書順先頭(four)

    // セッションはリファクタリング1本想定
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].taskType).toBe("refactor");

    expect(createJulesSession).not.toHaveBeenCalled();
  });

  it("limitパラメータによって実行リポジトリ数を1〜3にカスタマイズおよび制限されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/_template",
        id: "github/test-owner/_template",
        githubRepo: { owner: "test-owner", repo: "_template" },
      },
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
      {
        name: "sources/github/test-owner/app-two",
        id: "github/test-owner/app-two",
        githubRepo: { owner: "test-owner", repo: "app-two" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // limit=1 の場合
    const request1 = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&limit=1");
    const response1 = await POST(request1);
    const body1 = await response1.json();
    expect(body1.selectedRepos).toHaveLength(1);
    expect(body1.sessions).toHaveLength(1);

    // limit=5 の場合 => 最大値である 3 にクランプされる
    const request5 = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&limit=5");
    const response5 = await POST(request5);
    const body5 = await response5.json();
    expect(body5.selectedRepos).toHaveLength(2); // _template以外の対象リポジトリが2つしかないので2つ
    expect(body5.sessions).toHaveLength(2);

    // limit=0 の場合 => 最小値である 1 にクランプされる
    const request0 = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&limit=0");
    const response0 = await POST(request0);
    const body0 = await response0.json();
    expect(body0.selectedRepos).toHaveLength(1);
    expect(body0.sessions).toHaveLength(1);
  });

  it("Firestore上の最終実行日時履歴に基づいて、最終実行が古いリポジトリが優先的に選択されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/_template",
        id: "github/test-owner/_template",
        githubRepo: { owner: "test-owner", repo: "_template" },
      },
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
      {
        name: "sources/github/test-owner/app-two",
        id: "github/test-owner/app-two",
        githubRepo: { owner: "test-owner", repo: "app-two" },
      },
      {
        name: "sources/github/test-owner/app-three",
        id: "github/test-owner/app-three",
        githubRepo: { owner: "test-owner", repo: "app-three" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // Firestore 履歴を設定
    // app-one: 1時間前に実行
    // app-two: 1日前（24時間前）に実行
    // app-three: 未実行（履歴なし）
    const now = new Date().getTime();
    vi.mocked(getRepoLastExecutedTimes).mockResolvedValue({
      "app-one": new Date(now - 1 * 60 * 60 * 1000),
      "app-two": new Date(now - 24 * 60 * 60 * 1000),
    });

    // 制限 2個で実行した場合：未実行の app-three（最優先）と、24時間前の app-two が選ばれるはず（app-oneは除外）
    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&limit=2");
    const response = await POST(request);
    const body = await response.json();

    expect(body.selectedRepos).toEqual(["app-three", "app-two"]);
  });

  it("dryRun=false の際、実際に Jules API を叩いてセッションが作成され、Firestoreに最終実行日時が更新されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/_template",
        id: "github/test-owner/_template",
        githubRepo: { owner: "test-owner", repo: "_template" },
      },
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);
    vi.mocked(createJulesSession).mockImplementation(async (key, req) => {
      return {
        name: `sessions/mock-session-${req.title.replace(/\s+/g, "-")}`,
        id: "mock-id",
        title: req.title,
        prompt: req.prompt,
        sourceContext: req.sourceContext,
      };
    });

    vi.mocked(getRepoDefaultBranch).mockResolvedValue("develop");

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=false");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dryRun).toBe(false);
    expect(body.succeeded).toHaveLength(1); // app-one に対する refactor 1件
    expect(body.failed).toHaveLength(0);

    // Jules API セッション作成が呼び出され、sourceContext.githubRepoContext.startingBranch およびドキュメント更新のプロンプトが指定されたことを検証
    expect(createJulesSession).toHaveBeenCalledTimes(1);
    expect(createJulesSession).toHaveBeenCalledWith(
      "test-jules-key",
      expect.objectContaining({
        prompt: expect.stringContaining("documentation updates"),
        sourceContext: {
          source: "sources/github/test-owner/app-one",
          githubRepoContext: {
            startingBranch: "develop",
          },
        },
      })
    );

    // Firestoreの最終実行日時更新が 'app-one' に対して呼び出されたことを検証
    expect(updateRepoLastExecutedTime).toHaveBeenCalledWith("app-one");
  });

  it("非表示リポジトリ（hidden-repos）は Jules 自動化処理対象外となること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
      {
        name: "sources/github/test-owner/app-two",
        id: "github/test-owner/app-two",
        githubRepo: { owner: "test-owner", repo: "app-two" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);
    // app-one を非表示に設定
    vi.mocked(getHiddenRepos).mockResolvedValue(["app-one"]);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&limit=2");
    const response = await POST(request);
    const body = await response.json();

    // app-one が除外され、app-two のみが選択されること
    expect(body.selectedRepos).toEqual(["app-two"]);
  });

  it("24時間以内の残り作成枠が10未満の場合にセッション作成がスキップされること", async () => {
    const now = new Date();
    // 過去24時間以内に作成されたセッションを 6 件作成（残り枠: 15 - 6 = 9件 < 10件）
    const mockSessions = Array.from({ length: 6 }).map((_, i) => ({
      name: `sessions/${i}`,
      id: `${i}`,
      title: `session ${i}`,
      prompt: "prompt",
      sourceContext: { source: "source" },
      createTime: new Date(now.getTime() - i * 60 * 60 * 1000).toISOString(),
    }));

    vi.mocked(listAllJulesSessions).mockResolvedValue(mockSessions);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=false");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.skipped).toBe(true);
    expect(body.remainingCapacity).toBe(9);
    expect(body.message).toContain("Insufficient Jules session capacity");

    // リポジトリソースの取得やセッション作成が呼び出されないこと
    expect(listAllJulesSources).not.toHaveBeenCalled();
    expect(createJulesSession).not.toHaveBeenCalled();
  });

  it("24時間以内の残り作成枠が10以上の場合に正常に実行されること", async () => {
    const now = new Date();
    // 過去24時間以内に作成されたセッションを 5 件作成（残り枠: 15 - 5 = 10件 >= 10件）
    const mockSessions = Array.from({ length: 5 }).map((_, i) => ({
      name: `sessions/${i}`,
      id: `${i}`,
      title: `session ${i}`,
      prompt: "prompt",
      sourceContext: { source: "source" },
      createTime: new Date(now.getTime() - i * 60 * 60 * 1000).toISOString(),
    }));

    vi.mocked(listAllJulesSessions).mockResolvedValue(mockSessions);
    vi.mocked(listAllJulesSources).mockResolvedValue([
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ]);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.skipped).toBeUndefined();
    expect(body.selectedRepos).toEqual(["app-one"]);
  });

  it("Pub/Sub メッセージボディ内のパラメータを正しく処理できること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/_template",
        id: "github/test-owner/_template",
        githubRepo: { owner: "test-owner", repo: "_template" },
      },
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // Pub/Sub 形式 of message body
    const payload = Buffer.from(JSON.stringify({
      dryRun: false,
      task: "refactor"
    })).toString("base64");

    const bodyObj = {
      message: {
        data: payload
      }
    };

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation", bodyObj);

    vi.mocked(createJulesSession).mockResolvedValue({
      name: "sessions/mock-refactor",
      id: "mock-id",
      title: "mock",
      prompt: "mock",
      sourceContext: { source: "mock-source" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dryRun).toBe(false);
    expect(body.succeeded).toHaveLength(1);
    expect(body.succeeded[0].taskType).toBe("refactor");
    expect(createJulesSession).toHaveBeenCalledTimes(1);
    expect(updateRepoLastExecutedTime).toHaveBeenCalledWith("app-one");
  });
});
