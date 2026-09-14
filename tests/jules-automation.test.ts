import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listAllJulesSources,
  createJulesSession,
  listAllJulesSessions,
  getRemainingSessionCapacity,
} from "@/lib/jules-client";
import {
  getRepoLastExecutedTimes,
  updateRepoLastExecutedTime,
  getRootCollectionName,
  getHiddenRepos,
  getLastBatchExecutedTime,
  updateLastBatchExecutedTime,
  getJulesConfig,
  setJulesConfig,
  DEFAULT_JULES_CONFIG,
} from "@/lib/firestore-client";
import { GET as GET_CONFIG, POST as POST_CONFIG } from "@/app/api/jules-config/route";
import { getRepoDefaultBranch, getAllReposInfo } from "@/lib/github-client";
import { POST } from "@/app/api/jules-automation/route";
import { NextRequest } from "next/server";

// Jules APIクライアントの依存モジュールをモック
vi.mock("@/lib/jules-client", () => ({
  listAllJulesSources: vi.fn(),
  createJulesSession: vi.fn(),
  listAllJulesSessions: vi.fn(),
  getRemainingSessionCapacity: vi.fn(),
}));

// GitHubクライアントの依存モジュールをモック
vi.mock("@/lib/github-client", () => ({
  getRepoDefaultBranch: vi.fn(),
  getAllReposInfo: vi.fn(),
}));

// Firestoreクライアントの依存モジュールをモック
vi.mock("@/lib/firestore-client", () => ({
  getRepoLastExecutedTimes: vi.fn(),
  updateRepoLastExecutedTime: vi.fn(),
  getHiddenRepos: vi.fn(),
  getLastBatchExecutedTime: vi.fn(),
  updateLastBatchExecutedTime: vi.fn(),
  getJulesConfig: vi.fn(),
  setJulesConfig: vi.fn(),
  DEFAULT_JULES_CONFIG: {
    schedule: {
      sun: true, mon: true, tue: true, wed: true, thu: true, fri: true, sat: true,
    },
    excludedRepos: [],
  },
  getRootCollectionName: () => {
    const appEnv = process.env.APP_ENV;
    if (appEnv === "test") {
      return "myapps-portal-test";
    }
    return "myapps-portal";
  },
}));

describe("Jules Client Functions (Actual)", () => {
  it("listAllJulesSessions が fetch を使用して全セッションを取得すること", async () => {
    const { listAllJulesSessions } = await vi.importActual<typeof import("@/lib/jules-client")>("@/lib/jules-client");

    const mockFetch = vi.fn().mockImplementation(async (urlStr: string) => {
      const url = new URL(urlStr);
      const pageToken = url.searchParams.get("pageToken");
      if (!pageToken) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            sessions: [{ name: "sessions/1", id: "1", title: "s1", prompt: "p1", sourceContext: { source: "src1" } }],
            nextPageToken: "page2",
          }),
        };
      } else {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            sessions: [{ name: "sessions/2", id: "2", title: "s2", prompt: "p2", sourceContext: { source: "src2" } }],
          }),
        };
      }
    });

    vi.stubGlobal("fetch", mockFetch);

    const sessions = await listAllJulesSessions("test-api-key");
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe("1");
    expect(sessions[1].id).toBe("2");

    vi.unstubAllGlobals();
  });

  it("getRemainingSessionCapacity が直近24時間のセッション数を元に残容量を正しく計算すること", async () => {
    const { getRemainingSessionCapacity } = await vi.importActual<typeof import("@/lib/jules-client")>("@/lib/jules-client");
    const now = Date.now();
    const mockSessions = [
      { name: "sessions/1", id: "1", title: "s1", prompt: "p1", sourceContext: { source: "src1" }, createTime: new Date(now - 1 * 60 * 60 * 1000).toISOString() },
      { name: "sessions/2", id: "2", title: "s2", prompt: "p2", sourceContext: { source: "src2" }, createTime: new Date(now - 5 * 60 * 60 * 1000).toISOString() },
      { name: "sessions/3", id: "3", title: "s3", prompt: "p3", sourceContext: { source: "src3" }, createTime: new Date(now - 30 * 60 * 60 * 1000).toISOString() },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        sessions: mockSessions,
      }),
    });

    vi.stubGlobal("fetch", mockFetch);

    const remaining = await getRemainingSessionCapacity("test-api-key");
    expect(remaining).toBe(13);

    vi.unstubAllGlobals();
  });

  it("getRemainingSessionCapacity が24時間超の古いセッションを検知した時点で早期終了し、後続ページのフェッチを行わないこと", async () => {
    const { getRemainingSessionCapacity } = await vi.importActual<typeof import("@/lib/jules-client")>("@/lib/jules-client");
    const now = Date.now();
    const mockSessionsPage1 = [
      { name: "sessions/1", id: "1", title: "s1", prompt: "p1", sourceContext: { source: "src1" }, createTime: new Date(now - 1 * 60 * 60 * 1000).toISOString() },
      { name: "sessions/2", id: "2", title: "s2", prompt: "p2", sourceContext: { source: "src2" }, createTime: new Date(now - 25 * 60 * 60 * 1000).toISOString() }, // 25時間前
    ];

    const mockFetch = vi.fn().mockImplementation(async (urlStr: string) => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          sessions: mockSessionsPage1,
          nextPageToken: "should-not-fetch-page-2",
        }),
      };
    });

    vi.stubGlobal("fetch", mockFetch);

    const remaining = await getRemainingSessionCapacity("test-api-key");
    expect(remaining).toBe(14); // 1件のみカウント
    expect(mockFetch).toHaveBeenCalledTimes(1); // 次ページの fetch は呼ばれていないこと

    vi.unstubAllGlobals();
  });

  it("getRemainingSessionCapacity が直近24時間のセッション数が15(最大値)に達した時点で早期終了すること", async () => {
    const { getRemainingSessionCapacity } = await vi.importActual<typeof import("@/lib/jules-client")>("@/lib/jules-client");
    const now = Date.now();
    const mock15Sessions = Array.from({ length: 15 }, (_, i) => ({
      name: `sessions/${i}`,
      id: `${i}`,
      title: `s${i}`,
      prompt: `p${i}`,
      sourceContext: { source: `src${i}` },
      createTime: new Date(now - 10 * 60 * 1000).toISOString(),
    }));

    const mockFetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          sessions: mock15Sessions,
          nextPageToken: "should-not-fetch-page-2",
        }),
      };
    });

    vi.stubGlobal("fetch", mockFetch);

    const remaining = await getRemainingSessionCapacity("test-api-key");
    expect(remaining).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});

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

    // Jules クライアントのデフォルトモック
    vi.mocked(getRemainingSessionCapacity).mockResolvedValue(15);
    vi.mocked(listAllJulesSessions).mockResolvedValue([]);

    // FirestoreおよびGitHubのデフォルトモック
    vi.mocked(getRepoLastExecutedTimes).mockResolvedValue({});
    vi.mocked(updateRepoLastExecutedTime).mockResolvedValue(undefined);
    vi.mocked(getHiddenRepos).mockResolvedValue([]);
    vi.mocked(getLastBatchExecutedTime).mockResolvedValue(null);
    vi.mocked(updateLastBatchExecutedTime).mockResolvedValue(undefined);
    vi.mocked(getJulesConfig).mockResolvedValue(DEFAULT_JULES_CONFIG);
    vi.mocked(setJulesConfig).mockResolvedValue(undefined);
    vi.mocked(getRepoDefaultBranch).mockResolvedValue("test");

    const defaultReposMap = new Map([
      ["app-one", { repoUrl: "", issueUrl: "", julesUrl: "" }],
      ["app-two", { repoUrl: "", issueUrl: "", julesUrl: "" }],
      ["app-three", { repoUrl: "", issueUrl: "", julesUrl: "" }],
      ["app-four", { repoUrl: "", issueUrl: "", julesUrl: "" }],
      ["_template", { repoUrl: "", issueUrl: "", julesUrl: "" }],
    ]);
    vi.mocked(getAllReposInfo).mockResolvedValue(defaultReposMap as any);
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

  it("アーカイブされたリポジトリおよびGitHub一覧（getAllReposInfo）に存在しないリポジトリは Jules 自動化処理対象外となること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-active",
        id: "github/test-owner/app-active",
        githubRepo: { owner: "test-owner", repo: "app-active" },
      },
      {
        name: "sources/github/test-owner/app-archived",
        id: "github/test-owner/app-archived",
        githubRepo: { owner: "test-owner", repo: "app-archived" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // getAllReposInfo の返り値には app-active のみを設定（app-archived はアーカイブされているため含まれない想定）
    const activeReposMap = new Map([
      ["app-active", { repoUrl: "", issueUrl: "", julesUrl: "" }],
    ]);
    vi.mocked(getAllReposInfo).mockResolvedValue(activeReposMap as any);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&limit=2");
    const response = await POST(request);
    const body = await response.json();

    // app-archived が除外され、app-active のみが選択されること
    expect(body.selectedRepos).toEqual(["app-active"]);
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

  it("直近10分以内にバッチ実行があった場合、dryRun=false では処理がスキップ(skipped=true)されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];
    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // 直近2分前に実行された履歴を設定
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    vi.mocked(getLastBatchExecutedTime).mockResolvedValue(twoMinutesAgo);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=false");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.skipped).toBe(true);
    expect(body.dryRun).toBe(false);
    expect(createJulesSession).not.toHaveBeenCalled();
    expect(updateLastBatchExecutedTime).not.toHaveBeenCalled();
  });

  it("ignoreCooldown=true の場合は直近10分以内に実行があってもスキップされずに処理が実行されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];
    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);
    vi.mocked(createJulesSession).mockResolvedValue({
      name: "sessions/mock-session",
      id: "mock-id",
      title: "mock",
      prompt: "mock",
      sourceContext: { source: "sources/github/test-owner/app-one" },
    });

    // 直近2分前に実行された履歴を設定
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    vi.mocked(getLastBatchExecutedTime).mockResolvedValue(twoMinutesAgo);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=false&ignoreCooldown=true");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.skipped).toBeUndefined();
    expect(body.succeeded).toHaveLength(1);
    expect(createJulesSession).toHaveBeenCalledTimes(1);
    expect(updateLastBatchExecutedTime).toHaveBeenCalledTimes(1);
  });

  it("dryRun=true の場合は直近10分以内に実行があってもクールダウンチェックをスルーしてシミュレーションが返されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];
    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // 直近1分前に実行された履歴を設定
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);
    vi.mocked(getLastBatchExecutedTime).mockResolvedValue(oneMinuteAgo);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dryRun).toBe(true);
    expect(body.selectedRepos).toEqual(["app-one"]);
  });

  it("残容量が10未満（例: 9）の場合、dryRun=false でのバッチ実行がスキップ(skipped=true)されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];
    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);
    vi.mocked(getRemainingSessionCapacity).mockResolvedValue(9);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=false");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.skipped).toBe(true);
    expect(body.message).toContain("insufficient session capacity");
    expect(createJulesSession).not.toHaveBeenCalled();
  });

  it("残容量が10以上（例: 10）の場合、dryRun=false でのバッチ実行が正常に実行されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];
    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);
    vi.mocked(getRemainingSessionCapacity).mockResolvedValue(10);
    vi.mocked(createJulesSession).mockResolvedValue({
      name: "sessions/mock-session",
      id: "mock-id",
      title: "mock",
      prompt: "mock",
      sourceContext: { source: "sources/github/test-owner/app-one" },
    });

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=false");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.skipped).toBeUndefined();
    expect(body.succeeded).toHaveLength(1);
    expect(createJulesSession).toHaveBeenCalledTimes(1);
  });

  it("Jules 設定で除外されたリポジトリ (excludedRepos) が自動処理から除外されること", async () => {
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
    vi.mocked(getJulesConfig).mockResolvedValue({
      schedule: DEFAULT_JULES_CONFIG.schedule,
      excludedRepos: ["app-one"],
    });

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&limit=2");
    const response = await POST(request);
    const body = await response.json();

    expect(body.selectedRepos).toEqual(["app-two"]);
  });

  it("当日の曜日スケジュールが false の場合、ignoreSchedule なしの自動実行がスキップ(skipped=true)されること", async () => {
    const mockSources = [
      {
        name: "sources/github/test-owner/app-one",
        id: "github/test-owner/app-one",
        githubRepo: { owner: "test-owner", repo: "app-one" },
      },
    ];
    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    // 全曜日起動 OFF の設定を返す
    vi.mocked(getJulesConfig).mockResolvedValue({
      schedule: { sun: false, mon: false, tue: false, wed: false, thu: false, fri: false, sat: false },
      excludedRepos: [],
    });

    const { executeJulesAutomation } = await vi.importActual<typeof import("@/lib/jules-automation-logic")>("@/lib/jules-automation-logic");

    const result = await executeJulesAutomation({
      dryRun: false,
      julesApiKey: "test-key",
      githubOwner: "test-owner",
      ignoreSchedule: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.message).toContain("disabled for today");
  });
});

describe("Jules Config API エンドポイントのテスト", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJulesConfig).mockResolvedValue(DEFAULT_JULES_CONFIG);
    vi.mocked(setJulesConfig).mockResolvedValue(undefined);
  });

  it("GET /api/jules-config が Jules 設定を返却すること", async () => {
    const response = await GET_CONFIG();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(DEFAULT_JULES_CONFIG);
  });

  it("POST /api/jules-config が有効な設定を更新・保存すること", async () => {
    const updatedConfig = {
      schedule: { sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false },
      excludedRepos: ["app-excluded"],
    };

    const request = {
      json: async () => updatedConfig,
    } as unknown as Request;

    const response = await POST_CONFIG(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.config).toEqual(updatedConfig);
    expect(setJulesConfig).toHaveBeenCalledWith(updatedConfig);
  });

  it("POST /api/jules-config で無効なデータの場合に 400 エラーを返却すること", async () => {
    const request = {
      json: async () => ({ schedule: null, excludedRepos: [] }),
    } as unknown as Request;

    const response = await POST_CONFIG(request);
    expect(response.status).toBe(400);
  });
});
