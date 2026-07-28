import { toolDefinitions } from "./definitions.js";

export type ToolSurface = "hosted" | "local";

export const LOCAL_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "position_check",
  "trade_prepare",
  "trade_execute",
] as const);

export function isEligibleForSurface(
  definition: { readonly name: string; readonly surfaces: readonly ToolSurface[] },
  surface: ToolSurface,
): boolean {
  if (!definition.surfaces.includes(surface)) return false;
  if (surface === "hosted" && LOCAL_ONLY_TOOL_NAMES.has(definition.name)) return false;
  return true;
}

export function definitionsForSurface(surface: ToolSurface) {
  return toolDefinitions.filter((definition) => isEligibleForSurface(definition, surface));
}
