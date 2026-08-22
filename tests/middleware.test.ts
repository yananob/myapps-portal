import { describe, it, expect, vi } from "vitest";
import { middleware } from "@/middleware";
import { NextRequest, NextResponse } from "next/server";

// Mock NextResponse.rewrite and NextResponse.next to track calls and return mock response objects
vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return {
    ...original,
    NextResponse: {
      ...original.NextResponse,
      rewrite: vi.fn((url) => ({ status: "rewrite", url: url.toString() })),
      next: vi.fn(() => ({ status: "next" })),
    },
  };
});

describe("Middleware", () => {
  const createMockRequest = (method: string, urlStr: string) => {
    const url = new URL(urlStr);
    return {
      method,
      nextUrl: url,
    } as unknown as NextRequest;
  };

  it("should rewrite POST request on root (/) to /api/events", () => {
    const request = createMockRequest("POST", "https://example.com/");
    const result = middleware(request);

    expect(NextResponse.rewrite).toHaveBeenCalled();
    expect(result).toEqual({
      status: "rewrite",
      url: "https://example.com/api/events",
    });
  });

  it("should preserve query parameters when rewriting", () => {
    const request = createMockRequest("POST", "https://example.com/?dryRun=false&foo=bar");
    const result = middleware(request);

    expect(NextResponse.rewrite).toHaveBeenCalled();
    expect(result).toEqual({
      status: "rewrite",
      url: "https://example.com/api/events?dryRun=false&foo=bar",
    });
  });

  it("should pass through GET request on root (/) normally", () => {
    vi.mocked(NextResponse.next).mockClear();
    const request = createMockRequest("GET", "https://example.com/");
    const result = middleware(request);

    expect(NextResponse.next).toHaveBeenCalled();
    expect(result).toEqual({ status: "next" });
  });

  it("should pass through POST request on other paths normally", () => {
    vi.mocked(NextResponse.next).mockClear();
    const request = createMockRequest("POST", "https://example.com/api/services");
    const result = middleware(request);

    expect(NextResponse.next).toHaveBeenCalled();
    expect(result).toEqual({ status: "next" });
  });
});
