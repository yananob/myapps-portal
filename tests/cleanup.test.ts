import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the route handler
vi.mock("@/lib/gcp-client", () => ({
  getCloudRunServices: vi.fn(),
  deleteCloudRunService: vi.fn(),
}));

import { getCloudRunServices, deleteCloudRunService } from "@/lib/gcp-client";
import { POST } from "@/app/api/cleanup/route";
import { NextRequest } from "next/server";

describe("Cleanup API", () => {
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
      url: url || "http://localhost/api/cleanup",
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

  it("should default to dry-run (no deletion) when authorized and no params are specified", async () => {
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
    expect(body.deleted).toHaveLength(0);
    expect(deleteCloudRunService).not.toHaveBeenCalled();
  });

  it("should delete stale test services when authorized and dryRun=false", async () => {
    const request = createRequest("Bearer test-secret", "http://localhost/api/cleanup?dryRun=false");
    const now = new Date();
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);
    const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000);

    const mockServices = [
      { name: "app-test", updatedAt: thirtyHoursAgo, url: "", logUrl: "" }, // Should be deleted
      { name: "app-test-event", updatedAt: thirtyHoursAgo, url: "", logUrl: "" }, // Should be deleted
      { name: "app-test", updatedAt: tenHoursAgo, url: "", logUrl: "" }, // Too recent
      { name: "app-main", updatedAt: thirtyHoursAgo, url: "", logUrl: "" }, // Not a test service
      { name: "other-service", updatedAt: thirtyHoursAgo, url: "", logUrl: "" }, // Not a test service
    ];

    vi.mocked(getCloudRunServices).mockResolvedValue(mockServices as any);
    vi.mocked(deleteCloudRunService).mockResolvedValue(undefined as any);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(false);
    expect(body.deleted).toContain("app-test");
    expect(body.deleted).toContain("app-test-event");
    expect(body.deleted).toHaveLength(2);
    expect(deleteCloudRunService).toHaveBeenCalledTimes(2);
  });

  it("should handle partial failures in deletion when dryRun=false", async () => {
    const request = createRequest("Bearer test-secret", "http://localhost/api/cleanup?dryRun=false");
    const now = new Date();
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

    const mockServices = [
      { name: "service-1-test", updatedAt: thirtyHoursAgo, url: "", logUrl: "" },
      { name: "service-2-test", updatedAt: thirtyHoursAgo, url: "", logUrl: "" },
    ];

    vi.mocked(getCloudRunServices).mockResolvedValue(mockServices as any);
    vi.mocked(deleteCloudRunService).mockImplementation((name) => {
      if (name === "service-1-test") return Promise.resolve();
      return Promise.reject(new Error("Delete failed"));
    });

    const response = await POST(request);
    const body = await response.json();

    expect(body.deleted).toEqual(["service-1-test"]);
    expect(body.failed).toHaveLength(1);
    expect(body.message).toContain("Deleted: 1, Failed: 1");
  });

  it("should run as dry-run by default for event-based invocations", async () => {
    const request = createRequest(
      "Bearer test-secret",
      "http://localhost/api/cleanup",
      { "ce-type": "com.google.cloud.pubsub.topic.publish" }
    );
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
    expect(deleteCloudRunService).not.toHaveBeenCalled();
  });

  it("should support actual deletion in event invocation if dryRun=false is provided in Pub/Sub data", async () => {
    // base64 encoded string of {"topic": "myapps-portal-event", "command": "cleanup", "dryRun": false}
    const payload = Buffer.from(JSON.stringify({
      topic: "myapps-portal-event",
      command: "cleanup",
      dryRun: false
    })).toString("base64");

    const bodyObj = {
      message: {
        data: payload
      },
      subscription: "projects/test-pj/subscriptions/myapps-portal-event"
    };

    const request = createRequest(
      "Bearer test-secret",
      "http://localhost/api/cleanup",
      { "ce-type": "com.google.cloud.pubsub.topic.publish" },
      bodyObj
    );

    const now = new Date();
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

    const mockServices = [
      { name: "app-test", updatedAt: thirtyHoursAgo, url: "", logUrl: "" },
    ];

    vi.mocked(getCloudRunServices).mockResolvedValue(mockServices as any);
    vi.mocked(deleteCloudRunService).mockResolvedValue(undefined as any);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(false);
    expect(body.deleted).toContain("app-test");
    expect(deleteCloudRunService).toHaveBeenCalledTimes(1);
  });
});
