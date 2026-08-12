import { describe, it, expect, vi, beforeEach } from "vitest";
import { listAllJulesSources, createJulesSession } from "@/lib/jules-client";
import { POST } from "@/app/api/jules-automation/route";
import { NextRequest } from "next/server";

// Jules APIクライアントの依存モジュールをモック
vi.mock("@/lib/jules-client", () => ({
  listAllJulesSources: vi.fn(),
  createJulesSession: vi.fn(),
}));

describe("Jules Automation API エンドポイントのテスト", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.JULES_API_KEY = "test-jules-key";
    process.env.GITHUB_OWNER = "test-owner";
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

  it("認証に失敗した場合は 401  Unauthorized エラーを返却すること", async () => {
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

  it("Dry-run モードでタスク1とタスク2がシミュレートされること", async () => {
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
      // 他人のリポジトリは除外されるはず
      {
        name: "sources/github/other-owner/app-three",
        id: "github/other-owner/app-three",
        githubRepo: { owner: "other-owner", repo: "app-three" },
      },
    ];

    vi.mocked(listAllJulesSources).mockResolvedValue(mockSources);

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&task=all");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dryRun).toBe(true);
    expect(body.sessions).toBeDefined();

    // タスク1(template-sync) は、子リポジトリ2つに対して、それぞれ子→テンプとテンプ→子の2本＝計4本想定
    const templateSyncs = body.sessions.filter((s: any) => s.taskType === "template-sync");
    expect(templateSyncs).toHaveLength(4);

    // タスク2(refactor) は、辞書順にソートした子リポジトリ（app-one, app-two）から、日付ベースで1つ選択される
    const refactors = body.sessions.filter((s: any) => s.taskType === "refactor");
    expect(refactors).toHaveLength(1);
    const chosenRepo = refactors[0].repo;
    expect(["app-one", "app-two"]).toContain(chosenRepo);

    // 実際にAPIは呼び出されていないことの検証
    expect(createJulesSession).not.toHaveBeenCalled();
  });

  it("dryRun=false の際、実際に Jules API を叩いてセッションが作成されること", async () => {
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

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=false&task=all");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dryRun).toBe(false);
    expect(body.succeeded).toHaveLength(3); // タスク1: 1件の子x2本 = 2本 + タスク2: 1件 = 合計3件
    expect(body.failed).toHaveLength(0);

    // Jules API セッション作成が3回呼び出されたことを検証
    expect(createJulesSession).toHaveBeenCalledTimes(3);
  });

  it("特定のタスクのみを指定して実行できること (task=refactor)", async () => {
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

    const request = createRequest("Bearer test-cron-secret", "http://localhost/api/jules-automation?dryRun=true&task=refactor");
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].taskType).toBe("refactor");
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

    // Pub/Sub 形式のメッセージボディ
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
  });
});
