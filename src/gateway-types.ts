import type { z } from "zod";

/** Risk classification drives confirmation, approval and budget policy. */
export const RISK_LEVELS = ["READ", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const TOOL_CATEGORIES = ["PROJECT", "TASK", "AGENT", "QUALITY", "CONTROL", "DELIVERY"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Everything a tool is allowed to know about the caller. Never carries secrets. */
export type WebMcpContext = {
  orgId: string;
  userId: string;
  email: string | null;
};

export type WebMcpTool<Input = any> = {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  requiresHumanApproval: boolean;
  /** Input contract. Also rendered in the tool explorer. */
  inputSchema: z.ZodTypeAny;
  /** Human-readable description of the returned shape (explorer only). */
  outputHint: string;
  /**
   * Business logic. Never called directly by registration — the registry only
   * invokes it after the authorization gateway allows the call.
   */
  execute: (input: Input, ctx: WebMcpContext) => Promise<unknown>;
};

export type GatewayDecision = {
  allowed: boolean;
  denialCode:
    | null
    | "NOT_AUTHENTICATED"
    | "NO_WORKSPACE"
    | "UNKNOWN_TOOL"
    | "INVALID_INPUT"
    | "TOOL_NOT_PERMITTED"
    | "RESOURCE_FORBIDDEN"
    | "BUDGET_LIMIT"
    | "RISK_BLOCKED"
    | "APPROVAL_REQUIRED";
  reason: string | null;
  requiresApproval: boolean;
};

export type WebMcpToolResult =
  | { success: true; tool: string; data: unknown; riskLevel: RiskLevel; requiresApproval: boolean }
  | { success: false; tool: string; code: string; message: string };
