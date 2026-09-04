import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the route handler
vi.mock("@/lib/gcp-client", () => ({
  getCloudRunServices: vi.fn(),
  deleteCloudRunService: vi.fn(),
}));

vi.mock("@/lib/jules-client", () => ({
  listAllJulesSources: vi.fn(),
  createJulesSession: vi.fn(),
}));

vi.mock("@/lib/firestore-client", () => ({
  getRepoLastExecutedTimes: vi.fn(),
  updateRepoLastExecutedTime: vi.fn(),
  getHiddenRepos: vi.fn().mockResolvedValue([]),
  setRepoHidden: vi.fn(),
  getLastBatchExecutedTime: vi.fn().mockResolvedValue(null),
  updateLastBatchExecutedTime: vi.fn().mockResolvedValue(undefined),
}));

import { getCloudRunServices, deleteCloudRunService } from "@/lib/gcp-client";
import { listAllJulesSources } from "@/lib/jules-client";
import { getRepoLastExecutedTimes } from "@/lib/firestore-client";
import { POST } from "@/app/api/events/route";
import { NextRequest } from "next/server";

describe("Events API Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  const createRequest = (
    authHeader?: string,
    url?: string,
    headersObj?: Record<string, string>,
    bodyObj?: any
  ) => {
    const headersMap = new Map<string, string | null>([
      ["Authorization", authHeader || null],
      ...(headersObj ? Object.entries(headersObj) : []),
    ]);

    return {
      url: url || "http://localhost/api/events",
      headers: {
        get: (name: string) => headersMap.get(name) || null,
      },
      clone: () => ({
        text: async () => (bodyObj ? JSON.stringify(bodyObj) : ""),
      }),
    } as unknown as NextRequest;
  };

  it("should return 401 if unauthorized", async () => {
    const request = createRequest("Bearer wrong-secret");
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("should allow same-origin requests from dashboard UI without bearer token", async () => {
    const request = createRequest(
      undefined,
      "http://localhost/api/events",
      { "sec-fetch-site": "same-origin" }
    );
    vi.mocked(getCloudRunServices).mockResolvedValue([]);

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("should dispatch to cleanup by default when no command is specified", async () => {
    const request = createRequest("Bearer test-secret");
    const now = new Date();
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

    const mockServices = [
      { name: "app-test", updatedAt: thirtyHoursAgo, url: "", logUrl: "" },
    ];

    vi.mocked(getCloudRunServices).mockResolvedValue(mockServices as any);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.candidates).toContain("app-test");
    expect(getCloudRunServices).toHaveBeenCalledTimes(1);
  });

  it("should dispatch to jules-automation when command=jules-automation in Pub/Sub message data", async () => {
    process.env.JULES_API_KEY = "test-jules-key";
    process.env.GITHUB_OWNER = "test-owner";

    const payload = Buffer.from(
      JSON.stringify({
        topic: "myapps-portal-event",
        command: "jules-automation",
        dryRun: true,
      })
    ).toString("base64");

    const bodyObj = {
      message: {
        data: payload,
      },
      subscription: "projects/test-pj/subscriptions/myapps-portal-event",
    };

    const request = createRequest(
      "Bearer test-secret",
      "http://localhost/api/events",
      { "ce-type": "com.google.cloud.pubsub.topic.publish" },
      bodyObj
    );

    vi.mocked(listAllJulesSources).mockResolvedValue([
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
    ]);
    vi.mocked(getRepoLastExecutedTimes).mockResolvedValue({});

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.message).toContain("Simulated 1 Jules sessions");
    expect(listAllJulesSources).toHaveBeenCalledTimes(1);
  });

  it("should return 400 Bad Request for unknown commands", async () => {
    const request = createRequest(
      "Bearer test-secret",
      "http://localhost/api/events?command=unknown-task"
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unknown command: unknown-task");
  });
});
