import { call } from "./transport";
import type { WatchRule, WatchMatch } from "../types";

export async function getWatchRules(): Promise<WatchRule[]> {
  return call("get_watch_rules");
}

export async function addWatchRule(rule: WatchRule): Promise<WatchRule> {
  return call("add_watch_rule", { rule });
}

export async function updateWatchRule(rule: WatchRule): Promise<WatchRule> {
  return call("update_watch_rule", { rule });
}

export async function deleteWatchRule(id: string): Promise<void> {
  return call("delete_watch_rule", { id });
}

export async function getWatchMatches(ruleId?: string): Promise<WatchMatch[]> {
  return call("get_watch_matches", { ruleId: ruleId ?? null });
}

export async function clearWatchMatches(ruleId?: string): Promise<void> {
  return call("clear_watch_matches", { ruleId: ruleId ?? null });
}

export async function runWatchRuleNow(id: string): Promise<WatchMatch[]> {
  return call("run_watch_rule_now", { id });
}
