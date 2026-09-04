/**
 * Live mode — talk to a real Phloem workspace over the OAuth 2.1–secured
 * MCP server at https://pholem.com/mcp.
 *
 * The tool names are identical to the sandbox surface in `tools.ts`, so a
 * prompt written against the demo works unchanged against live data. The only
 * difference is that every call here runs server-side as the signed-in user:
 * row-level security, per-workspace tool policies, budget accounts, the
 * human-approval boundary and the audit trail are all enforced by Phloem.
 *
 * This module is a thin, dependency-free MCP Streamable HTTP client. Bring your
 * own access token (obtained through the server's OAuth 2.1 flow — discovery
 * lives at `/.well-known/oauth-protected-resource`).
 */

import type { RiskLevel } from "./gateway-types";

export const PHLOEM_MCP_URL = "https://pholem.com/mcp";

/** Tool names exposed by the live Phloem MCP server (engineering surface). */
export const LIVE_ENGINEERING_TOOLS = [
  "phloem_get_project_status",
  "phloem_get_blockers",
  "phloem_get_task",
  "phloem_get_budget",
  "phloem_create_task",
  "phloem_assign_agent",
  "phloem_run_task",
  "phloem_run_tests",
  "phloem_request_review",
  "phloem_deploy_release",
  "phloem_approve_release",
  "phloem_delete_project",
  "phloem_get_repository_credentials",
] as const;

export type LiveEngineeringTool = (typeof LIVE_ENGINEERING_TOOLS)[number];

/** Risk classification enforced server-side; mirrors the sandbox gateway. */
export const LIVE_TOOL_RISK: Record<LiveEngineeringTool, RiskLevel> = {
  phloem_get_project_status: "READ",
  phloem_get_blockers: "READ",
  phloem_get_task: "READ",
  phloem_get_budget: "READ",
  phloem_create_task: "LOW",
  phloem_assign_agent: "LOW",
  phloem_run_task: "MEDIUM",
  phloem_run_tests: "MEDIUM",
  phloem_request_review: "MEDIUM",
  phloem_deploy_release: "HIGH",
  phloem_approve_release: "CRITICAL",
  phloem_delete_project: "CRITICAL",
  phloem_get_repository_credentials: "CRITICAL",
};

export type LiveClientOptions = {
  /** OAuth 2.1 access token for the signed-in Phloem user. */
  accessToken: string;
  /** Override the server URL (self-hosted or preview deployments). */
  url?: string;
  fetchImpl?: typeof fetch;
};

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpCallResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

/** Parses either a JSON body or a `text/event-stream` body into one JSON-RPC message. */
function parseBody<T>(contentType: string, body: string): JsonRpcResponse<T> {
  if (contentType.includes("text/event-stream")) {
    const payload = body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    return JSON.parse(payload) as JsonRpcResponse<T>;
  }
  return JSON.parse(body) as JsonRpcResponse<T>;
}

/**
 * Minimal MCP Streamable HTTP client for the Phloem server.
 *
 * ```ts
 * const client = new PhloemLiveClient({ accessToken });
 * await client.initialize();
 * const tools = await client.listTools();
 * const status = await client.callTool("phloem_get_project_status", {});
 * ```
 */
export class PhloemLiveClient {
  private readonly url: string;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(options: LiveClientOptions) {
    this.url = options.url ?? PHLOEM_MCP_URL;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Required by the MCP Streamable HTTP spec — servers reject calls without it.
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.accessToken}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params: params ?? {} }),
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Phloem MCP request failed [${response.status}]: ${text}`);
    }

    const message = parseBody<T>(response.headers.get("content-type") ?? "", text);
    if (message.error) {
      throw new Error(`Phloem MCP error ${message.error.code}: ${message.error.message}`);
    }
    return message.result as T;
  }

  /** Handshake; must run before listTools/callTool. */
  async initialize(clientName = "phloem-webmcp-agent"): Promise<unknown> {
    return this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: clientName, version: "0.2.0" },
    });
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.rpc<{ tools: McpToolDescriptor[] }>("tools/list");
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    return this.rpc<McpCallResult>("tools/call", { name, arguments: args });
  }
}

/** Fetches the OAuth protected-resource discovery document for a Phloem deployment. */
export async function discoverPhloemAuth(
  origin = "https://pholem.com",
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${origin}/.well-known/oauth-protected-resource`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Discovery failed [${response.status}]: ${await response.text()}`);
  }
  return (await response.json()) as Record<string, unknown>;
}
