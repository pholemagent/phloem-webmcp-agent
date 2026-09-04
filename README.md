# phloem-webmcp-agent

Open-source (MIT) **WebMCP agent surface** extracted from [Phloem](https://pholem.com) — an agentic engineering-control platform.

It gives a browser page a set of governed tools that any WebMCP-capable agent (ChatGPT's in-app browser, Chrome with WebMCP enabled, Claude, Cursor…) can discover and call through `document.modelContext` — with **risk classification, budget enforcement, and a human-approval boundary** built in.

> The Phloem product itself is private and proprietary. This package is the standalone, self-contained agent surface plus its sandbox state machine, published under MIT so anyone can read, run, and learn from the governance model.

## Why

Giving an agent tools is easy. Giving it tools you can *trust in production* is not. This package demonstrates the minimum viable governance layer:

| Guard | Behaviour |
| --- | --- |
| **Risk classification** | Every tool is `READ` / `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`. |
| **Hard block** | `CRITICAL` tools (delete project, read repository credentials) are always refused — `RISK_BLOCKED` / `SECRET_ACCESS_DENIED`. |
| **Budget guard** | Cost-incurring tools estimate spend and are refused with `BUDGET_LIMIT` when the project budget would be exceeded. |
| **Human approval** | Release deploy cannot proceed until a human approves in the UI — the agent can only *request* it. |
| **Audit trail** | Every call (allowed, denied, failed) appends a timestamped event with the actor, tool, decision and denial code. |

## Install

```bash
npm install phloem-webmcp-agent
# peer deps: react >= 18, zod >= 3
```

## Usage

```ts
import { registerDemoTools, isDemoAgentAvailable } from "phloem-webmcp-agent";

// In a client component / effect — registers the tools on document.modelContext
useEffect(() => registerDemoTools(), []);

// Show the user whether a WebMCP-capable agent is present
const agentReady = isDemoAgentAvailable();
```

Reading and reacting to sandbox state in React:

```tsx
import { useDemoState, resetDemoState, money } from "phloem-webmcp-agent";

function BudgetCard() {
  const state = useDemoState();
  return <p>Spent {money(state.project.spentCents)} of {money(state.project.budgetCents)}</p>;
}
```

Calling a tool directly (what the agent does under the hood):

```ts
import { runDemoTool } from "phloem-webmcp-agent";

const result = await runDemoTool("phloem_run_tests", { taskKey: "PH-103" });
// { ok: true, data: {...} } | { ok: false, code: "BUDGET_LIMIT", message: "..." }
```

## Tools

| Tool | Risk | Notes |
| --- | --- | --- |
| `phloem_get_project_status` | READ | tasks by state, blockers, agents, CI, budget, approvals |
| `phloem_get_blockers` | READ | blocked tasks with reasons + acceptance criteria |
| `phloem_get_task` | READ | single task detail |
| `phloem_get_budget` | READ | limit / spent / remaining |
| `phloem_create_task` | LOW | adds a task to the backlog |
| `phloem_assign_agent` | LOW | assigns engineer / tester / reviewer |
| `phloem_run_task` | MEDIUM | consumes budget, moves task through the pipeline |
| `phloem_run_tests` | MEDIUM | consumes budget, updates CI |
| `phloem_request_review` | MEDIUM | hands work to the reviewer role |
| `phloem_deploy_release` | HIGH | blocked until a human approves |
| `phloem_approve_release` | CRITICAL | **always refused** — humans only |
| `phloem_delete_project` | CRITICAL | **always refused** |
| `phloem_get_repository_credentials` | CRITICAL | **always refused** (`SECRET_ACCESS_DENIED`) |

## Sandbox state

State is a seeded software release ("Checkout v1.4": 5 tasks, 3 agents, a budget, CI results, one pending approval) persisted in `localStorage` under `phloem.webmcp.demo`. It is fully client-side — no backend, no network, no credentials. `resetDemoState()` restores the seed at any time.

Exports: `seedDemoState`, `getDemoState`, `setDemoState`, `updateDemoState`, `resetDemoState`, `appendDemoEvent`, `spendDemoBudget`, `useDemoState`, plus helpers `remainingCents`, `releaseReadiness`, `findTask`, `money`, and the shared gateway types (`RISK_LEVELS`, `TOOL_CATEGORIES`, `WebMcpTool`, `GatewayDecision`, `WebMcpToolResult`).

## Live demo

<https://pholem.com/demo> — no login, no setup. Open it in ChatGPT's in-app browser or Chrome with WebMCP enabled and ask the agent to unblock the failing checkout tests; watch it hit the budget guard and stop at the human-approval boundary.

## License

MIT — see [LICENSE](./LICENSE).
