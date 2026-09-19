export type MascotTheme = "dark" | "light";

export type CatState =
  | "idle"
  | "blink"
  | "sleep"
  | "curious"
  | "fetching"
  | "collapsed";

export const LOADER_SESSION_KEY = "zwawa-mascot-loader-seen-v1";
export const CAT_COLLAPSED_KEY = "zwawa-cat-pet-collapsed-v1";
export const LOADER_MIN_DURATION = 420;
export const LOADER_MAX_DURATION = 1400;

export function getNextMascotTarget(current: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const normalized = Number.isFinite(current) ? Math.trunc(current) : 0;
  return ((normalized % total) + total) % total;
}

export function getCatStatus(state: CatState): string {
  switch (state) {
    case "sleep":
      return "猫猫正在睡觉";
    case "curious":
      return "猫猫正在思考";
    case "fetching":
      return "蜘蛛正在整理档案";
    case "collapsed":
      return "召回猫猫";
    case "blink":
      return "猫猫眨了眨眼";
    default:
      return "猫猫正在发呆";
  }
}
