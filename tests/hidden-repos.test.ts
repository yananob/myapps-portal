import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/hidden-repos/route";
import { getHiddenRepos, setRepoHidden } from "@/lib/firestore-client";
import { NextRequest } from "next/server";

vi.mock("@/lib/firestore-client", () => ({
  getHiddenRepos: vi.fn(),
  setRepoHidden: vi.fn(),
}));

describe("Hidden Repos API エンドポイントのテスト", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/hidden-repos", () => {
    it("非表示リポジトリ一覧を取得してレスポンスとして返すこと", async () => {
      vi.mocked(getHiddenRepos).mockResolvedValue(["repo-a", "repo-b"]);

      const response = await GET();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ hiddenRepos: ["repo-a", "repo-b"] });
      expect(getHiddenRepos).toHaveBeenCalledTimes(1);
    });

    it("エラー発生時に 500 エラーを返すこと", async () => {
      vi.mocked(getHiddenRepos).mockRejectedValue(new Error("Firestore Error"));

      const response = await GET();
      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data).toEqual({ error: "Firestore Error" });
    });
  });

  describe("POST /api/hidden-repos", () => {
    const createPostRequest = (bodyObj: any) => {
      return {
        json: async () => bodyObj,
      } as unknown as NextRequest;
    };

    it("正しく repo と hidden パラメータが渡された場合に setRepoHidden を呼び出すこと (hidden=true)", async () => {
      vi.mocked(setRepoHidden).mockResolvedValue(undefined);

      const req = createPostRequest({ repo: "app-test", hidden: true });
      const response = await POST(req);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ success: true, repo: "app-test", hidden: true });
      expect(setRepoHidden).toHaveBeenCalledWith("app-test", true);
    });

    it("正しく repo と hidden パラメータが渡された場合に setRepoHidden を呼び出すこと (hidden=false)", async () => {
      vi.mocked(setRepoHidden).mockResolvedValue(undefined);

      const req = createPostRequest({ repo: "app-test", hidden: false });
      const response = await POST(req);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ success: true, repo: "app-test", hidden: false });
      expect(setRepoHidden).toHaveBeenCalledWith("app-test", false);
    });

    it("無効な repo が渡された場合は 400 エラーを返すこと", async () => {
      const req = createPostRequest({ repo: 123, hidden: true });
      const response = await POST(req);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe("無効なリポジトリ名が指定されました。");
    });

    it("無効な hidden が渡された場合は 400 エラーを返すこと", async () => {
      const req = createPostRequest({ repo: "app-test", hidden: "yes" });
      const response = await POST(req);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe("無効な hidden フラグが指定されました。");
    });
  });
});
