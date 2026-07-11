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

  const createRequest = (url: string = "http://localhost/api/cleanup", authHeader?: string) => {
    return {
      url,
      headers: {
        get: (name: string) => (name === "Authorization" ? authHeader : null),
      },
    } as unknown as NextRequest;
  };

  it("should return 500 if CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const request = createRequest("http://localhost/api/cleanup", "Bearer test-secret");
    const response = await POST(request);
    expect(response.status).toBe(500);
  });

  it("should return 401 if unauthorized", async () => {
    const request = createRequest("http://localhost/api/cleanup", "Bearer wrong-secret");
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("should default to dry-run and not delete services", async () => {
    const request = createRequest("http://localhost/api/cleanup", "Bearer test-secret");
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
    expect(body.identified).toContain("app-test");
    expect(deleteCloudRunService).not.toHaveBeenCalled();
  });

  it("should delete stale test services when dryRun=false is specified", async () => {
    const request = createRequest("http://localhost/api/cleanup?dryRun=false", "Bearer test-secret");
    const now = new Date();
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);
    const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000);

    const mockServices = [
      { name: "app-test", updatedAt: thirtyHoursAgo, url: "", logUrl: "" }, // Should be deleted
      { name: "app-test-event", updatedAt: thirtyHoursAgo, url: "", logUrl: "" }, // Should be deleted
      { name: "app-test", updatedAt: tenHoursAgo, url: "", logUrl: "" }, // Too recent
      { name: "app-main", updatedAt: thirtyHoursAgo, url: "", logUrl: "" }, // Not a test service
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
    const request = createRequest("http://localhost/api/cleanup?dryRun=false", "Bearer test-secret");
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
});
