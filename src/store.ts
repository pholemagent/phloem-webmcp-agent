/**
 * Sandbox store for the WebMCP demo. State lives in the browser only, so a
 * judge can drive the whole scenario without an account and a reset can never
 * touch a real workspace.
 */
import { useSyncExternalStore } from "react";
import { DEMO_VERSION, seedDemoState, type DemoActor, type DemoEvent, type DemoState } from "./state";

const STORAGE_KEY = "phloem.webmcp.demo";

let state: DemoState = seedDemoState();
let hydrated = false;
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode: the demo simply becomes session-only */
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function hydrateDemoState() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed?.version === DEMO_VERSION) state = parsed;
    }
  } catch {
    /* corrupt payload: keep the deterministic seed */
  }
  emit();
}

export function getDemoState(): DemoState {
  return state;
}

export function setDemoState(next: DemoState) {
  state = next;
  persist();
  emit();
}

export function updateDemoState(mutate: (draft: DemoState) => void) {
  const next: DemoState = JSON.parse(JSON.stringify(state));
  mutate(next);
  setDemoState(next);
}

export function resetDemoState() {
  setDemoState(seedDemoState());
}

let sequence = 0;

export function appendDemoEvent(event: {
  actor: DemoActor;
  action: string;
  tool?: string | null;
  target?: string | null;
  decision?: DemoEvent["decision"];
  status?: string | null;
  costCents?: number;
  denialCode?: string | null;
}) {
  sequence += 1;
  const entry: DemoEvent = {
    id: `evt-${Date.now()}-${sequence}`,
    at: new Date().toISOString(),
    actor: event.actor,
    action: event.action,
    tool: event.tool ?? null,
    target: event.target ?? null,
    decision: event.decision ?? "info",
    status: event.status ?? null,
    costCents: event.costCents ?? 0,
    denialCode: event.denialCode ?? null,
  };
  updateDemoState((draft) => {
    draft.events.unshift(entry);
    draft.events = draft.events.slice(0, 200);
  });
  return entry;
}

export function spendDemoBudget(cents: number, taskKey: string | null) {
  updateDemoState((draft) => {
    draft.project.spentCents += cents;
    if (taskKey) {
      const task = draft.tasks.find((item) => item.key === taskKey);
      if (task) task.spentCents += cents;
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot = seedDemoState();

export function useDemoState(): DemoState {
  return useSyncExternalStore(subscribe, getDemoState, () => serverSnapshot);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
