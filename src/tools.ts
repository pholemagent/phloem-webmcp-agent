/**
 * The demo tool surface.
 *
 * These tools mirror the production Phloem WebMCP tools — same names, same
 * risk classification, same gateway shape — but they operate on the isolated
 * sandbox state. Every call is validated, authorized against risk and budget
 * policy, recorded on the activity timeline, and refused when it would exceed
 * budget or requires a human.
 */
import { z } from "zod";
import { findTask, money, remainingCents, type DemoRole } from "./state";
import { appendDemoEvent, getDemoState, sleep, spendDemoBudget, updateDemoState } from "./store";

export type DemoRisk = "READ" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type DemoTool = {
  name: string;
  title: string;
  description: string;
  risk: DemoRisk;
  requiresHumanApproval: boolean;
  inputSchema: z.ZodTypeAny;
  outputHint: string;
  execute: (input: any) => Promise<unknown>;
};

export type DemoToolResult =
  | { success: true; tool: string; data: unknown; riskLevel: DemoRisk; requiresHumanApproval: boolean }
  | { success: false; tool: string; code: string; message: string; requiresHumanAction: boolean };

const taskRef = z.object({ taskKey: z.string().min(3) });

function taskView(key: string) {
  const task = findTask(getDemoState(), key);
  if (!task) throw new Error(`Task ${key} does not exist in the demo project.`);
  return task;
}

export const DEMO_TOOLS: DemoTool[] = [
  {
    name: "phloem_get_project_status",
    title: "Get project status",
    description: "Live delivery status of the demo release: tasks by state, blockers, agents, CI, budget and approvals.",
    risk: "READ",
    requiresHumanApproval: false,
    inputSchema: z.object({}),
    outputHint: "{ project, tasksByState, blockers, agents, ci, budget, pendingApprovals }",
    execute: async () => {
      const state = getDemoState();
      const tasksByState: Record<string, number> = {};
      for (const task of state.tasks) tasksByState[task.status] = (tasksByState[task.status] ?? 0) + 1;
      return {
        project: { name: state.project.name, release: state.project.release },
        tasksByState,
        blockers: state.tasks.filter((task) => task.status === "blocked").map((task) => task.key),
        agents: state.agents.map((agent) => ({ role: agent.role, status: agent.status, currentTask: agent.currentTask })),
        ci: state.ci,
        budget: {
          limitCents: state.project.budgetCents,
          spentCents: state.project.spentCents,
          remainingCents: remainingCents(state),
        },
        pendingApprovals: state.approvals.filter((approval) => approval.state === "pending").map((a) => a.key),
      };
    },
  },
  {
    name: "phloem_get_blockers",
    title: "Get blockers",
    description: "Every blocked task with its block reason and acceptance criteria.",
    risk: "READ",
    requiresHumanApproval: false,
    inputSchema: z.object({}),
    outputHint: "{ blockers: [{ taskKey, title, blockReason, acceptanceCriteria, suggestedRoles }] }",
    execute: async () => ({
      blockers: getDemoState()
        .tasks.filter((task) => task.status === "blocked")
        .map((task) => ({
          taskKey: task.key,
          title: task.title,
          blockReason: task.blockReason,
          acceptanceCriteria: task.acceptanceCriteria,
          suggestedRoles: ["engineer", "tester", "reviewer"],
          estimatedCostCents: task.estimateCents,
        })),
    }),
  },
  {
    name: "phloem_get_task",
    title: "Get task",
    description: "Full detail of one task: status, assignee, acceptance criteria, tests, review and spend.",
    risk: "READ",
    requiresHumanApproval: false,
    inputSchema: taskRef,
    outputHint: "{ task }",
    execute: async (input: { taskKey: string }) => ({ task: taskView(input.taskKey) }),
  },
  {
    name: "phloem_get_budget",
    title: "Get budget",
    description: "Budget limit, consumption and remaining headroom for the demo project.",
    risk: "READ",
    requiresHumanApproval: false,
    inputSchema: z.object({}),
    outputHint: "{ limitCents, spentCents, remainingCents, perTask }",
    execute: async () => {
      const state = getDemoState();
      return {
        limitCents: state.project.budgetCents,
        spentCents: state.project.spentCents,
        remainingCents: remainingCents(state),
        perTask: state.tasks.map((task) => ({ taskKey: task.key, spentCents: task.spentCents })),
      };
    },
  },
  {
    name: "phloem_create_task",
    title: "Create task",
    description: "Creates a task in the demo project. Acceptance criteria are mandatory — Phloem never runs unbounded work.",
    risk: "LOW",
    requiresHumanApproval: false,
    inputSchema: z.object({
      title: z.string().trim().min(4).max(160),
      summary: z.string().trim().max(1000).default(""),
      acceptanceCriteria: z.array(z.string().trim().min(3)).min(1).max(10),
      estimateCents: z.number().int().min(0).max(1000).default(25),
    }),
    outputHint: "{ task }",
    execute: async (input: { title: string; summary: string; acceptanceCriteria: string[]; estimateCents: number }) => {
      const state = getDemoState();
      const key = `PH-${100 + state.tasks.length + 1}`;
      updateDemoState((draft) => {
        draft.tasks.push({
          key,
          title: input.title,
          summary: input.summary,
          status: "backlog",
          assignee: null,
          blockReason: null,
          acceptanceCriteria: input.acceptanceCriteria,
          estimateCents: input.estimateCents,
          spentCents: 0,
          tests: null,
          review: null,
        });
      });
      return { task: taskView(key) };
    },
  },
  {
    name: "phloem_assign_agent",
    title: "Assign agent",
    description: "Assigns a task to one of the demo agent roles.",
    risk: "MEDIUM",
    requiresHumanApproval: false,
    inputSchema: taskRef.extend({ role: z.enum(["engineer", "tester", "reviewer"]) }),
    outputHint: "{ task }",
    execute: async (input: { taskKey: string; role: DemoRole }) => {
      const task = taskView(input.taskKey);
      updateDemoState((draft) => {
        const row = draft.tasks.find((item) => item.key === task.key)!;
        row.assignee = input.role;
      });
      return { task: taskView(task.key) };
    },
  },
  {
    name: "phloem_run_task",
    title: "Run task",
    description:
      "Starts the assigned engineering agent on a task. Spends model budget, so it is refused when the remaining project budget cannot cover the estimate.",
    risk: "HIGH",
    requiresHumanApproval: false,
    inputSchema: taskRef,
    outputHint: "{ runId, status, costCents }",
    execute: async (input: { taskKey: string }) => {
      const task = taskView(input.taskKey);
      const role: DemoRole = task.assignee ?? "engineer";
      updateDemoState((draft) => {
        const row = draft.tasks.find((item) => item.key === task.key)!;
        row.status = "in_progress";
        row.assignee = role;
        row.blockReason = null;
        const agent = draft.agents.find((item) => item.role === role)!;
        agent.status = "running";
        agent.currentTask = task.key;
      });
      appendDemoEvent({ actor: role, action: `${role} started ${task.key}`, target: task.key, decision: "info" });
      await sleep(1400);
      const cost = Math.max(8, Math.round(task.estimateCents * 0.58));
      spendDemoBudget(cost, task.key);
      updateDemoState((draft) => {
        const agent = draft.agents.find((item) => item.role === role)!;
        agent.status = "idle";
        agent.currentTask = null;
      });
      appendDemoEvent({
        actor: role,
        action: `${role} completed implementation for ${task.key}`,
        target: task.key,
        decision: "info",
        status: "completed",
        costCents: cost,
      });
      return { runId: `run-${task.key.toLowerCase()}`, status: "completed", costCents: cost, role };
    },
  },
  {
    name: "phloem_run_tests",
    title: "Run tests",
    description: "Runs the tester agent against a task's acceptance criteria and refreshes CI status.",
    risk: "HIGH",
    requiresHumanApproval: false,
    inputSchema: taskRef,
    outputHint: "{ passed, total, ci }",
    execute: async (input: { taskKey: string }) => {
      const task = taskView(input.taskKey);
      updateDemoState((draft) => {
        const agent = draft.agents.find((item) => item.role === "tester")!;
        agent.status = "running";
        agent.currentTask = task.key;
      });
      appendDemoEvent({ actor: "tester", action: `Tester started on ${task.key}`, target: task.key });
      await sleep(1200);
      const cost = 7;
      spendDemoBudget(cost, task.key);
      updateDemoState((draft) => {
        const row = draft.tasks.find((item) => item.key === task.key)!;
        row.tests = { passed: 8, total: 8 };
        row.status = "review";
        draft.ci = { failing: 0, passing: 8, status: "green" };
        const agent = draft.agents.find((item) => item.role === "tester")!;
        agent.status = "idle";
        agent.currentTask = null;
      });
      appendDemoEvent({
        actor: "tester",
        action: `8 / 8 tests passed for ${task.key}`,
        target: task.key,
        status: "passed",
        costCents: cost,
      });
      return { passed: 8, total: 8, ci: getDemoState().ci, costCents: cost };
    },
  },
  {
    name: "phloem_request_review",
    title: "Request review",
    description: "Runs the code reviewer against the acceptance criteria and moves the task to the approval boundary.",
    risk: "HIGH",
    requiresHumanApproval: false,
    inputSchema: taskRef,
    outputHint: "{ verdict, readyForApproval, approvalKey }",
    execute: async (input: { taskKey: string }) => {
      const task = taskView(input.taskKey);
      updateDemoState((draft) => {
        const agent = draft.agents.find((item) => item.role === "reviewer")!;
        agent.status = "running";
        agent.currentTask = task.key;
      });
      appendDemoEvent({ actor: "reviewer", action: `Code reviewer started on ${task.key}`, target: task.key });
      await sleep(1200);
      const cost = 6;
      spendDemoBudget(cost, task.key);
      const approvalKey = `PH-APR-${14 + getDemoState().approvals.length}`;
      updateDemoState((draft) => {
        const row = draft.tasks.find((item) => item.key === task.key)!;
        row.review = "approved";
        row.status = "ready_for_approval";
        const agent = draft.agents.find((item) => item.role === "reviewer")!;
        agent.status = "idle";
        agent.currentTask = null;
        draft.approvals.push({
          key: approvalKey,
          taskKey: task.key,
          kind: "release",
          requestedBy: "WebMCP agent",
          createdAt: new Date().toISOString(),
          state: "pending",
        });
      });
      appendDemoEvent({
        actor: "reviewer",
        action: `Review passed for ${task.key}`,
        target: task.key,
        status: "approved",
        costCents: cost,
      });
      appendDemoEvent({
        actor: "phloem",
        action: `Human approval required — ${approvalKey} created, execution paused`,
        target: task.key,
        decision: "info",
        status: "paused",
      });
      return { verdict: "approved", readyForApproval: true, approvalKey, requiresHumanApproval: true, costCents: cost };
    },
  },
  {
    name: "phloem_deploy_release",
    title: "Deploy release",
    description: "Requests a deployment. Phloem never deploys on an agent's word — it opens an approval request instead.",
    risk: "HIGH",
    requiresHumanApproval: true,
    inputSchema: taskRef,
    outputHint: "{ deployed: false, approvalKey, requiresHumanApproval: true }",
    execute: async (input: { taskKey: string }) => {
      const task = taskView(input.taskKey);
      const approvalKey = `PH-APR-${14 + getDemoState().approvals.length}`;
      updateDemoState((draft) => {
        draft.approvals.push({
          key: approvalKey,
          taskKey: task.key,
          kind: "deployment",
          requestedBy: "WebMCP agent",
          createdAt: new Date().toISOString(),
          state: "pending",
        });
      });
      return {
        deployed: false,
        approvalKey,
        requiresHumanApproval: true,
        message: `Deployment requires human approval. Approval request ${approvalKey} has been created.`,
      };
    },
  },
  {
    name: "phloem_approve_release",
    title: "Approve release",
    description: "Approval is a human-only action. Exposed so agents receive an explicit refusal instead of a silent failure.",
    risk: "CRITICAL",
    requiresHumanApproval: true,
    inputSchema: taskRef,
    outputHint: "refused — humans approve in the Phloem UI",
    execute: async () => ({ approved: false }),
  },
  {
    name: "phloem_delete_project",
    title: "Delete project",
    description: "Destructive workspace operation. Never available to an external agent.",
    risk: "CRITICAL",
    requiresHumanApproval: true,
    inputSchema: z.object({}),
    outputHint: "refused — not available through WebMCP",
    execute: async () => ({ deleted: false }),
  },
  {
    name: "phloem_get_repository_credentials",
    title: "Get repository credentials",
    description: "Secret material. Never returned through WebMCP under any permission level.",
    risk: "CRITICAL",
    requiresHumanApproval: true,
    inputSchema: z.object({}),
    outputHint: "refused — secrets are never exposed through WebMCP",
    execute: async () => ({ credentials: null }),
  },
];

export function findDemoTool(name: string): DemoTool | undefined {
  return DEMO_TOOLS.find((tool) => tool.name === name);
}

/**
 * The sandbox gateway. Same decision order as the production gateway:
 * validation -> tool permission -> risk policy -> resource -> budget policy.
 */
export async function runDemoTool(name: string, rawInput: unknown): Promise<DemoToolResult> {
  const tool = findDemoTool(name);
  if (!tool) {
    appendDemoEvent({
      actor: "external_agent",
      action: `Rejected unknown tool ${name}`,
      tool: name,
      decision: "denied",
      denialCode: "UNKNOWN_TOOL",
    });
    return { success: false, tool: name, code: "UNKNOWN_TOOL", message: `Unknown tool ${name}.`, requiresHumanAction: false };
  }

  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    appendDemoEvent({
      actor: "external_agent",
      action: `Rejected ${tool.name}: invalid input`,
      tool: tool.name,
      decision: "denied",
      denialCode: "INVALID_INPUT",
    });
    return {
      success: false,
      tool: tool.name,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "),
      requiresHumanAction: false,
    };
  }

  if (tool.risk === "CRITICAL") {
    const code = tool.name === "phloem_get_repository_credentials" ? "SECRET_ACCESS_DENIED" : "RISK_BLOCKED";
    const message =
      tool.name === "phloem_get_repository_credentials"
        ? "Access denied. Secrets are never exposed through WebMCP."
        : "This action is not available through WebMCP. A human performs it inside Phloem.";
    appendDemoEvent({
      actor: "external_agent",
      action: `Refused ${tool.name}`,
      tool: tool.name,
      decision: "denied",
      denialCode: code,
      status: message,
    });
    return { success: false, tool: tool.name, code, message, requiresHumanAction: true };
  }

  const input = parsed.data as Record<string, unknown>;
  const taskKey = typeof input["taskKey"] === "string" ? (input["taskKey"] as string) : null;

  if (taskKey && !findTask(getDemoState(), taskKey)) {
    appendDemoEvent({
      actor: "external_agent",
      action: `Refused ${tool.name}: unknown task ${taskKey}`,
      tool: tool.name,
      target: taskKey,
      decision: "denied",
      denialCode: "RESOURCE_FORBIDDEN",
    });
    return {
      success: false,
      tool: tool.name,
      code: "RESOURCE_FORBIDDEN",
      message: `Task ${taskKey} is not part of this sandbox project.`,
      requiresHumanAction: false,
    };
  }

  // Budget policy: an execution that cannot be paid for never starts an agent.
  if (tool.risk === "HIGH" && taskKey) {
    const state = getDemoState();
    const task = findTask(state, taskKey)!;
    const available = remainingCents(state);
    if (task.estimateCents > available) {
      appendDemoEvent({
        actor: "external_agent",
        action: `Execution blocked for ${task.key}: needs ${money(task.estimateCents)}, ${money(available)} left`,
        tool: tool.name,
        target: task.key,
        decision: "denied",
        denialCode: "BUDGET_LIMIT",
        status: "no agent started, no repository changes",
      });
      return {
        success: false,
        tool: tool.name,
        code: "BUDGET_LIMIT",
        message: `Budget policy prevented this action. Required ${money(task.estimateCents)}, available ${money(available)}. No agent was started and no repository changes were made.`,
        requiresHumanAction: true,
      };
    }
  }

  appendDemoEvent({
    actor: "external_agent",
    action: `External agent called ${tool.name}`,
    tool: tool.name,
    target: taskKey,
    decision: "allowed",
  });

  try {
    const data = await tool.execute(parsed.data);
    return { success: true, tool: tool.name, data, riskLevel: tool.risk, requiresHumanApproval: tool.requiresHumanApproval };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    appendDemoEvent({
      actor: "phloem",
      action: `${tool.name} failed`,
      tool: tool.name,
      target: taskKey,
      decision: "denied",
      denialCode: "EXECUTION_FAILED",
      status: message.slice(0, 120),
    });
    return { success: false, tool: tool.name, code: "EXECUTION_FAILED", message, requiresHumanAction: false };
  }
}

type ModelContext = {
  registerTool: (descriptor: {
    name: string;
    description: string;
    inputSchema: unknown;
    annotations?: Record<string, unknown>;
    execute: (input: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
  }) => (() => void) | void;
};

function modelContext(): ModelContext | null {
  if (typeof document === "undefined") return null;
  const candidate = (document as unknown as { modelContext?: ModelContext }).modelContext;
  return candidate && typeof candidate.registerTool === "function" ? candidate : null;
}

export function isDemoAgentAvailable(): boolean {
  return modelContext() !== null;
}

/** Registers the sandbox tools with the browser agent. No account required. */
export function registerDemoTools(): () => void {
  const surface = modelContext();
  if (!surface) return () => {};
  const disposers: (() => void)[] = [];
  for (const tool of DEMO_TOOLS) {
    const dispose = surface.registerTool({
      name: tool.name,
      description: `${tool.description} (risk: ${tool.risk})`,
      inputSchema: tool.inputSchema,
      annotations: {
        title: tool.title,
        readOnlyHint: tool.risk === "READ",
        destructiveHint: tool.risk === "HIGH" || tool.risk === "CRITICAL",
      },
      execute: async (input: unknown) => {
        const result = await runDemoTool(tool.name, input);
        return result.success
          ? { content: [{ type: "text" as const, text: JSON.stringify(result.data) }] }
          : {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ success: false, code: result.code, message: result.message, requiresHumanAction: result.requiresHumanAction }),
                },
              ],
              isError: true,
            };
      },
    });
    if (typeof dispose === "function") disposers.push(dispose);
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* surface already gone */
      }
    }
  };
}
