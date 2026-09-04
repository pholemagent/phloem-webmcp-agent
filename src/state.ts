/**
 * Deterministic WebMCP demo sandbox.
 *
 * This state is isolated from every real workspace: nothing here reads or
 * writes production projects, repositories, secrets or model budget. It exists
 * so an external agent can drive a complete Phloem delivery workflow —
 * blocked -> engineering -> testing -> review -> awaiting human approval —
 * without any setup.
 */

export type DemoTaskStatus = "backlog" | "blocked" | "in_progress" | "review" | "ready_for_approval" | "done";

export type DemoRole = "engineer" | "tester" | "reviewer";

export type DemoTask = {
  key: string;
  title: string;
  summary: string;
  status: DemoTaskStatus;
  assignee: DemoRole | null;
  blockReason: string | null;
  acceptanceCriteria: string[];
  /** Estimated model spend for one execution, in cents. Drives the budget guard. */
  estimateCents: number;
  spentCents: number;
  tests: { passed: number; total: number } | null;
  review: "pending" | "approved" | "changes_requested" | null;
};

export type DemoAgent = {
  role: DemoRole;
  label: string;
  model: string;
  status: "idle" | "running";
  currentTask: string | null;
};

export type DemoActor = "external_agent" | "engineer" | "tester" | "reviewer" | "human" | "phloem";

export type DemoEvent = {
  id: string;
  at: string;
  actor: DemoActor;
  action: string;
  tool: string | null;
  target: string | null;
  decision: "allowed" | "denied" | "info";
  status: string | null;
  costCents: number;
  denialCode: string | null;
};

export type DemoApproval = {
  key: string;
  taskKey: string;
  kind: "deployment" | "release";
  requestedBy: "WebMCP agent";
  createdAt: string;
  state: "pending" | "approved" | "changes_requested";
};

export type DemoState = {
  version: number;
  project: {
    name: string;
    release: string;
    budgetCents: number;
    spentCents: number;
  };
  ci: { failing: number; passing: number; status: "green" | "red" };
  tasks: DemoTask[];
  agents: DemoAgent[];
  approvals: DemoApproval[];
  events: DemoEvent[];
};

export const DEMO_VERSION = 3;

export const AGENT_LABELS: Record<DemoRole, string> = {
  engineer: "Engineer",
  tester: "Tester",
  reviewer: "Code reviewer",
};

export const STATUS_LABELS: Record<DemoTaskStatus, string> = {
  backlog: "Backlog",
  blocked: "Blocked",
  in_progress: "In progress",
  review: "In review",
  ready_for_approval: "Ready for approval",
  done: "Done",
};

export const BOARD_COLUMNS: DemoTaskStatus[] = ["backlog", "blocked", "in_progress", "review", "ready_for_approval", "done"];

export function seedDemoState(): DemoState {
  return {
    version: DEMO_VERSION,
    project: { name: "WebMCP Commerce Demo", release: "Checkout v1.4", budgetCents: 500, spentCents: 435 },
    ci: { failing: 3, passing: 5, status: "red" },
    tasks: [
      {
        key: "PH-101",
        title: "Add checkout API",
        summary: "POST /checkout accepts a cart and returns an order id.",
        status: "done",
        assignee: "engineer",
        blockReason: null,
        acceptanceCriteria: ["Endpoint returns an order id", "Cart totals are recalculated server-side"],
        estimateCents: 0,
        spentCents: 210,
        tests: { passed: 6, total: 6 },
        review: "approved",
      },
      {
        key: "PH-102",
        title: "Add checkout validation",
        summary: "Reject invalid emails and empty carts before payment authorisation.",
        status: "done",
        assignee: "engineer",
        blockReason: null,
        acceptanceCriteria: ["Invalid email rejected", "Empty cart rejected"],
        estimateCents: 0,
        spentCents: 225,
        tests: { passed: 4, total: 4 },
        review: "approved",
      },
      {
        key: "PH-103",
        title: "Fix failing checkout tests",
        summary: "3 checkout validation tests fail after the latest change to the cart total calculation.",
        status: "blocked",
        assignee: null,
        blockReason: "3 checkout validation tests fail after the latest change.",
        acceptanceCriteria: [
          "Invalid email rejected",
          "Empty cart rejected",
          "Valid checkout returns success",
          "All CI tests pass",
        ],
        estimateCents: 31,
        spentCents: 0,
        tests: { passed: 5, total: 8 },
        review: null,
      },
      {
        key: "PH-104",
        title: "Release Checkout v1.4",
        summary: "Ship the checkout release once engineering, tests, CI and review are green.",
        status: "backlog",
        assignee: null,
        blockReason: null,
        acceptanceCriteria: ["All release tasks done", "CI green", "Human approval recorded"],
        estimateCents: 12,
        spentCents: 0,
        tests: null,
        review: null,
      },
      {
        key: "PH-105",
        title: "Budget alert at 80% consumption",
        summary:
          "Feature request: warn the workspace when 80% of a project's execution budget has been consumed, before agents are started.",
        status: "backlog",
        assignee: null,
        blockReason: null,
        acceptanceCriteria: [
          "Alert raised at 80% of budget",
          "Alert visible on the project page",
          "No duplicate alerts per threshold",
        ],
        estimateCents: 120,
        spentCents: 0,
        tests: null,
        review: null,
      },
    ],
    agents: [
      { role: "engineer", label: AGENT_LABELS.engineer, model: "gemini-3-pro", status: "idle", currentTask: null },
      { role: "tester", label: AGENT_LABELS.tester, model: "gemini-3-flash", status: "idle", currentTask: null },
      { role: "reviewer", label: AGENT_LABELS.reviewer, model: "gemini-3-flash", status: "idle", currentTask: null },
    ],
    approvals: [],
    events: [],
  };
}

export function remainingCents(state: DemoState): number {
  return Math.max(0, state.project.budgetCents - state.project.spentCents);
}

export function releaseReadiness(state: DemoState): number {
  const weights: Record<DemoTaskStatus, number> = {
    backlog: 0,
    blocked: 0.1,
    in_progress: 0.4,
    review: 0.7,
    ready_for_approval: 0.9,
    done: 1,
  };
  const total = state.tasks.reduce((sum, task) => sum + weights[task.status], 0);
  return Math.round((total / state.tasks.length) * 100);
}

export function findTask(state: DemoState, key: string): DemoTask | undefined {
  return state.tasks.find((task) => task.key.toLowerCase() === key.trim().toLowerCase());
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
