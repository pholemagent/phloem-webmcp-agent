# Roadmap — what still needs to be done

This package currently ships the **sandbox surface**: 13 governed tools registered on
`document.modelContext`, backed by a local, resettable state machine. The governance
model (risk classification, budget guard, human-approval boundary, audit trail) is real
and fully exercised, but the work it performs is simulated.

The items below are what stands between this package and an agent that executes real
work inside a live Phloem workspace.

## 1. Live mode against the Phloem MCP server

- [ ] Add a `live` transport alongside the sandbox transport, targeting `https://pholem.com/mcp`.
- [ ] OAuth 2.1 handshake with dynamic client registration (the server already supports it):
      discovery at `/.well-known/oauth-protected-resource`, consent screen, token refresh.
- [ ] Same tool names in both modes, so a prompt written against the sandbox runs unchanged
      against a real workspace.
- [ ] Mode indicator surfaced to the agent (`phloem_get_project_status` returns `mode: "sandbox" | "live"`).

## 2. Engineering tools on the server surface

The OAuth-secured `/mcp` server today exposes the prospecting toolset. The engineering
tools that this package advertises live only in the browser surface.

- [ ] Port the engineering tool group (project status, blockers, task read/create,
      agent assignment, task run, test run, review request, budget read) to the server surface.
- [ ] Keep destructive operations (project delete, credential read, release deploy)
      out of the surface entirely or behind `phloem_request_approval`.
- [ ] Re-run the manifest extractor and verify `/mcp` still rejects anonymous calls.

## 3. Server-side enforcement parity

- [ ] Enforce risk classification and denial codes server-side, not just in the client package —
      the browser guard is defence in depth, not the boundary.
- [ ] Per-workspace budget debiting on the server, with the same `BUDGET_LIMIT` denial code.
- [ ] Row-level-security-scoped execution: every call runs as the signed-in user.
- [ ] Persist audit events server-side with input hashing and secret redaction.

## 4. Real execution backends

- [ ] `phloem_run_task` → dispatch to the real agent runtime instead of mutating local state.
- [ ] `phloem_run_tests` → real CI provider results rather than seeded counts.
- [ ] `phloem_deploy_release` → real deploy record + provider call, still gated on human approval.
- [ ] External repository writes (GitHub PR/merge) — currently stubbed.

## 5. Package quality

- [ ] Unit tests for every denial path (`RISK_BLOCKED`, `SECRET_ACCESS_DENIED`, `BUDGET_LIMIT`,
      `APPROVAL_REQUIRED`, validation failures).
- [ ] Type-only entry point so consumers can import the gateway types without the sandbox.
- [ ] Publish to npm (currently source-only via GitHub).
- [ ] Documented client compatibility matrix (ChatGPT in-app browser, Chrome + WebMCP, Claude, Cursor).

## Non-goals

- Re-implementing the Phloem product. Phloem itself stays private and proprietary; this
  package is only the agent-facing surface and its governance model.
- Shipping credentials of any kind. Credential-reading tools are permanently refused.
