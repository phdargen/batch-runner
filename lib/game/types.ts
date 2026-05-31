export type ObstacleType = "bank" | "gap";

export type Platform = {
  x: number;
  /** Walkable surface height in pixels above ground. */
  elev: number;
  tileCount: number;
  width: number;
};

export type Obstacle = {
  type: ObstacleType;
  x: number;
  y: number;
  width: number;
  height: number;
  passed: boolean;
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

export type Cloud = {
  x: number;
  y: number;
  width: number;
  opacity: number;
  speed: number;
};

export type GamePhase = "idle" | "running" | "falling" | "game-over";

export type VisualZone = "calm" | "dusk" | "night" | "overdrive";

export type DinoReaction = "none" | "obstacle-hit" | "gap-fall";

export type GameState = {
  phase: GamePhase;
  distance: number;
  speed: number;
  dinoY: number;
  dinoVelocity: number;
  isJumping: boolean;
  obstacles: Obstacle[];
  platforms: Platform[];
  particles: Particle[];
  clouds: Cloud[];
  groundOffset: number;
  frameCount: number;
  jumpCooldownMs: number;
  /** Set when the dino leaves the top of the canvas; cleared once visible again. */
  topJumpLocked: boolean;
  bankPenaltyJumpsLeft: number;
  screenShake: number;
  lastObstacleDistance: number;
  lastObstacleType: ObstacleType | null;
  lastPlatformDistance: number;
  gapForbiddenSlots: number;
  /** Run distance before another gap may spawn (2× last gap width safe zone). */
  nextGapAllowedDistance: number;
  bankForbiddenSlots: number;
  platformForbiddenSlots: number;
  runFrame: number;
  runFrameTimer: number;
  dinoReaction: DinoReaction;
  dinoReactionTimerMs: number;
};

export const GROUND_Y = 0.78;
export const DINO_WIDTH = 40;
export const DINO_HEIGHT = 48;
export const GRAVITY = 0.65;
export const JUMP_VELOCITY = -14.53;
export const BASE_SPEED = 4;
export const MAX_SPEED = 12;
export const SPEED_INCREMENT = 0.0003;
export const OBSTACLE_MIN_GAP = 300;
export const JUMP_COOLDOWN_MS = 320;
export const BANK_PENALTY_JUMPS = 5;
export const BANK_TOP_BOUNCE_VELOCITY = -9;
export const BANK_TOP_LANDING_TOLERANCE = 16;
/** Swept horizontal look-ahead for pre-scroll roof bounce checks. */
export const BANK_ROOF_LEADING_MARGIN = 12;
/** Width of the bank's left edge where descent-from-above gets extra forgiveness. */
export const BANK_LEADING_EDGE_WIDTH = 40;
/** Feet must be at least this far above ground to treat bank contact as a roof bounce. */
export const BANK_ROOF_MIN_AIRBORNE_PX = 12;
export const PLATFORM_BOTTOM_BOUNCE_VELOCITY = 9;
export const PLATFORM_BOTTOM_HIT_TOLERANCE = 14;
export const JUMP_BUFFER_MS = 120;
export const MAX_FALL_VELOCITY = 18;
export const GAP_FALL_MARGIN = 8;
export const HAZARD_GAP_BONUS = 80;
/** Max height reachable from a single ground jump (px above ground). */
export const MAX_GROUND_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
/** Ground-reachable tiers (single jump from floor). */
export const PLATFORM_ELEV_LEVELS = [115, 138, 158] as const;
/** Above MAX_GROUND_JUMP_HEIGHT — needs a platform hop or mid-air double jump. */
export const PLATFORM_ELEV_LEVEL_HIGH = 178;
export const PLATFORM_HIGH_SPAWN_CHANCE = 0.25;
export const PLATFORM_MIN_GAP = 380;
export const PLATFORM_TOP_LANDING_TOLERANCE = 22;
