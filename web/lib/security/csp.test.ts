import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, webSocketSources } from "@/lib/security/csp";

describe("webSocketSources", () => {
  it("derives ws/wss origins for the page and a cross-origin API", () => {
    expect(webSocketSources("", "https://quiz.example.com")).toEqual(["wss://quiz.example.com"]);
    expect(webSocketSources("https://api.example.com", "https://quiz.example.com")).toEqual(["wss://quiz.example.com", "wss://api.example.com"]);
    expect(webSocketSources("", "http://localhost:3000")).toEqual(["ws://localhost:3000"]);
  });

  it("drops malformed or suspicious hosts", () => {
    expect(webSocketSources("not a url", "")).toEqual([]);
    expect(webSocketSources("", "https://evil;script-src *")).toEqual([]);
  });

  it("adds them to connect-src", () => {
    const csp = buildContentSecurityPolicy("n0nce", "", false, ["wss://quiz.example.com"]);
    expect(csp).toContain("connect-src 'self' wss://quiz.example.com");
    expect(csp).not.toContain("ws: wss:");
  });
});
