import type { GameState, Obstacle, Platform, Cloud, ObstacleType, GamePhase } from "./types";
import {
  PLATFORM_DRAW_WIDTH,
  PLATFORM_DRAW_HEIGHT,
  getGroundY,
} from "./sprites";
import {
  DINO_WIDTH,
  DINO_HEIGHT,
  GRAVITY,
  JUMP_VELOCITY,
  BASE_SPEED,
  MAX_SPEED,
  SPEED_INCREMENT,
  OBSTACLE_MIN_GAP,
  JUMP_COOLDOWN_MS,
  MAX_FALL_VELOCITY,
  GAP_FALL_MARGIN,
  HAZARD_GAP_BONUS,
  PLATFORM_ELEV_LEVELS,
  PLATFORM_ELEV_LEVEL_HIGH,
  PLATFORM_HIGH_SPAWN_CHANCE,
  PLATFORM_MIN_GAP,
  PLATFORM_TOP_LANDING_TOLERANCE,
  PLATFORM_BOTTOM_BOUNCE_VELOCITY,
  PLATFORM_BOTTOM_HIT_TOLERANCE,
  GAME_VIEWPORT_WIDTH,
} from "./types";

export function createInitialState(): GameState {
  return {
    phase: "idle",
    distance: 0,
    speed: BASE_SPEED,
    dinoY: 0,
    dinoVelocity: 0,
    isJumping: false,
    obstacles: [],
    platforms: [],
    particles: [],
    clouds: initClouds(),
    groundOffset: 0,
    frameCount: 0,
    jumpCooldownMs: 0,
    topJumpLocked: false,
    screenShake: 0,
    lastObstacleDistance: 0,
    lastObstacleType: null,
    lastPlatformDistance: 0,
    gapForbiddenSlots: 0,
    nextGapAllowedDistance: 0,
    platformForbiddenSlots: 0,
    runFrame: 0,
    runFrameTimer: 0,
    dinoReaction: "none",
    dinoReactionTimerMs: 0,
  };
}

function initClouds(): Cloud[] {
  return Array.from({ length: 5 }, () => ({
    x: Math.random() * GAME_VIEWPORT_WIDTH,
    y: 30 + Math.random() * 100,
    width: 40 + Math.random() * 60,
    opacity: 0.1 + Math.random() * 0.15,
    speed: 0.3 + Math.random() * 0.5,
  }));
}

export type EngineCallbacks = {
  onJumpCost: () => boolean | Promise<boolean>; // returns false if insufficient balance
  onGameOver: () => void;
  canvasWidth: number;
  canvasHeight: number;
};

const RUN_FRAME_MS = 90;

function advanceRunFrame(state: GameState, dt: number) {
  state.runFrameTimer += dt;
  if (state.runFrameTimer >= RUN_FRAME_MS) {
    state.runFrame = (state.runFrame + 1) % 3;
    state.runFrameTimer = 0;
  }
}

/**
 * Attempts a paid jump. Airborne jumps are allowed once the fast recharge is ready.
 */
export async function tryJump(state: GameState, callbacks: EngineCallbacks): Promise<boolean> {
  if (state.phase === "game-over") return false;

  const rescueFromPit = state.phase === "falling";
  if (!rescueFromPit && state.jumpCooldownMs > 0) return false;
  if (!rescueFromPit && state.topJumpLocked) return false;

  const canPay = await callbacks.onJumpCost();
  if (!canPay) return false;

  if ((state.phase as GamePhase) === "game-over") return false;

  if (state.phase === "idle") {
    state.phase = "running";
  } else if (rescueFromPit) {
    state.phase = "running";
    state.dinoReaction = "none";
    state.dinoReactionTimerMs = 0;
  }

  state.dinoVelocity = JUMP_VELOCITY;
  state.isJumping = true;
  state.jumpCooldownMs = JUMP_COOLDOWN_MS;

  spawnJumpParticles(state, 80 + DINO_WIDTH / 2, getGroundY(callbacks.canvasHeight) + state.dinoY);
  return true;
}

export function tick(state: GameState, dt: number, callbacks: EngineCallbacks): GameState {
  if (state.phase === "idle" || state.phase === "game-over") {
    updateClouds(state, callbacks.canvasWidth);
    advanceRunFrame(state, dt);
    state.frameCount++;
    return state;
  }

  if (state.phase === "running") {
    state.speed = Math.min(MAX_SPEED, state.speed + SPEED_INCREMENT * dt);
    state.distance += state.speed * (dt / 16);
    state.groundOffset += state.speed;
    maybeSpawnObstacle(state, callbacks);
    maybeSpawnPlatform(state, callbacks);
  }

  state.jumpCooldownMs = Math.max(0, state.jumpCooldownMs - dt);
  state.dinoReactionTimerMs = Math.max(0, state.dinoReactionTimerMs - dt);
  if (state.dinoReactionTimerMs === 0 && state.dinoReaction !== "gap-fall") {
    state.dinoReaction = "none";
  }

  // Dino physics (jump arc or falling through a gap — allow dinoY > 0 when falling)
  if (state.isJumping || state.phase === "falling") {
    state.dinoVelocity += GRAVITY;
    if (state.dinoVelocity > MAX_FALL_VELOCITY) state.dinoVelocity = MAX_FALL_VELOCITY;
    const prevDinoY = state.dinoY;
    state.dinoY += state.dinoVelocity;

    if (
      state.phase === "running" &&
      state.dinoVelocity >= 0 &&
      tryLandOnPlatform(state, callbacks, prevDinoY)
    ) {
      // Snapped onto a platform top.
    } else if (
      state.phase === "running" &&
      tryBounceOffPlatformBottom(state, callbacks, prevDinoY)
    ) {
      // Head hit a platform underside — bounced downward.
    } else {
      const descendingOrGrounded = state.dinoVelocity >= 0;
      const landed =
        state.phase !== "falling" && state.dinoY >= 0 && descendingOrGrounded;
      if (landed) {
        state.dinoY = 0;
        state.dinoVelocity = 0;
        state.isJumping = false;
      }
    }
  }

  updateTopJumpLock(state, callbacks);

  if (state.phase === "running") {
    advanceRunFrame(state, dt);
  }

  if (state.phase === "running") {
    for (const obs of state.obstacles) {
      obs.x -= state.speed;
    }
    for (const platform of state.platforms) {
      platform.x -= state.speed;
    }
  }

  checkCollisions(state, callbacks);
  checkPlatformSupport(state, callbacks);

  if (state.phase === "falling") {
    finalizeGapFallIfOffScreen(state, callbacks);
  }

  // Cull offscreen obstacles and platforms
  state.obstacles = state.obstacles.filter((o) => o.x + o.width > -50);
  state.platforms = state.platforms.filter((p) => p.x + p.width > -50);

  // Update particles and clouds
  updateParticles(state);
  updateClouds(state, callbacks.canvasWidth);

  // Screen shake decay
  if (state.screenShake > 0) {
    state.screenShake = Math.max(0, state.screenShake - 0.15);
  }
  if (state.distance > 7000) {
    state.screenShake = Math.max(state.screenShake, 1.5);
  }

  state.frameCount++;
  return state;
}

function updateTopJumpLock(state: GameState, callbacks: EngineCallbacks) {
  if (state.phase === "falling" || state.phase === "game-over") return;

  const groundY = getGroundY(callbacks.canvasHeight);
  const dinoScreenY = groundY - DINO_HEIGHT + state.dinoY;

  if (dinoScreenY < 0) {
    state.topJumpLocked = true;
  } else if (state.topJumpLocked) {
    state.topJumpLocked = false;
  }
}

function maybeSpawnObstacle(state: GameState, callbacks: EngineCallbacks) {
  let gap = getObstacleGap(state.distance);
  if (state.gapForbiddenSlots > 0) {
    gap += HAZARD_GAP_BONUS;
  }
  if (state.distance - state.lastObstacleDistance < gap) return;

  const gapsForbidden =
    state.distance < state.nextGapAllowedDistance || state.gapForbiddenSlots > 0;
  if (state.gapForbiddenSlots > 0) {
    state.gapForbiddenSlots--;
  }

  const type = chooseObstacleType(gapsForbidden);
  if (!type) {
    state.lastObstacleDistance = state.distance;
    return;
  }

  const obs: Obstacle = {
    type,
    x: callbacks.canvasWidth + 20,
    y: 0,
    width: getObstacleWidth(state.distance),
    height: 0,
    passed: false,
  };

  if (overlapsAnyGap(obs.x, obs.width, state.obstacles)) {
    return;
  }

  state.obstacles.push(obs);
  state.lastObstacleDistance = state.distance;
  state.lastObstacleType = type;

  const gapSafeZone = state.distance + obs.width * 2;
  state.nextGapAllowedDistance = Math.max(state.nextGapAllowedDistance, gapSafeZone);
  state.platformForbiddenSlots = Math.max(state.platformForbiddenSlots, GAP_NEAR_SPAWN_SLOTS);
}

const PLATFORM_SPAWN_CHANCE = 0.22;
const PLATFORM_START_DISTANCE = 900;

function pickPlatformElev(): number {
  if (Math.random() < PLATFORM_HIGH_SPAWN_CHANCE) return PLATFORM_ELEV_LEVEL_HIGH;
  return PLATFORM_ELEV_LEVELS[Math.floor(Math.random() * PLATFORM_ELEV_LEVELS.length)];
}

function maybeSpawnPlatform(state: GameState, callbacks: EngineCallbacks) {
  if (state.distance < PLATFORM_START_DISTANCE) return;
  if (state.platformForbiddenSlots > 0) {
    state.platformForbiddenSlots--;
    return;
  }
  if (state.distance - state.lastPlatformDistance < PLATFORM_MIN_GAP) return;
  if (Math.random() >= PLATFORM_SPAWN_CHANCE) return;

  const tileCount = 1 + Math.floor(Math.random() * 4);
  const width = tileCount * PLATFORM_DRAW_WIDTH;
  const x = callbacks.canvasWidth + 20;
  const elev = pickPlatformElev();

  const platform: Platform = { x, elev, tileCount, width };
  state.platforms.push(platform);
  state.lastPlatformDistance = state.distance;
}

const GAP_SPAWN_CHANCE = 0.3;
/** Share of spawn rolls that place no hazard. */
const OBSTACLE_EMPTY_WEIGHT = 0.22;
const GAP_NEAR_SPAWN_SLOTS = 1;

/** Gap width = base * multiplier; higher multipliers are rarer. */
const GAP_WIDTH_TIERS = [
  { mult: 1, weight: 54 },
  { mult: 2, weight: 28 },
  { mult: 3, weight: 12 },
  { mult: 4, weight: 6 },
] as const;

function chooseObstacleType(gapsForbidden: boolean): ObstacleType | null {
  if (gapsForbidden) return null;

  const total = GAP_SPAWN_CHANCE + OBSTACLE_EMPTY_WEIGHT;
  if (Math.random() * total < GAP_SPAWN_CHANCE) return "gap";
  return null;
}

function rollGapWidthMultiplier(): number {
  const totalWeight = GAP_WIDTH_TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const tier of GAP_WIDTH_TIERS) {
    roll -= tier.weight;
    if (roll <= 0) return tier.mult;
  }
  return 1;
}

function getObstacleWidth(distance: number): number {
  const difficultyBonus = Math.min(50, distance / 180);
  const baseWidth = 70 + Math.random() * 35 + difficultyBonus;
  return baseWidth * rollGapWidthMultiplier();
}

function overlapsHorizontally(aX: number, aW: number, bX: number, bW: number): boolean {
  return aX < bX + bW && aX + aW > bX;
}

function overlapsAnyGap(x: number, width: number, obstacles: Obstacle[]): boolean {
  return obstacles.some(
    (obs) => obs.type === "gap" && overlapsHorizontally(x, width, obs.x, obs.width),
  );
}

function getObstacleGap(distance: number): number {
  if (distance < 2000) return OBSTACLE_MIN_GAP;
  if (distance < 5000) return OBSTACLE_MIN_GAP * 0.7;
  if (distance < 7000) return OBSTACLE_MIN_GAP * 0.5;
  return OBSTACLE_MIN_GAP * 0.35;
}

function checkCollisions(state: GameState, callbacks: EngineCallbacks) {
  if (state.phase === "falling") return;

  const dinoX = 80;
  const groundY = getGroundY(callbacks.canvasHeight);
  const dinoScreenY = groundY - DINO_HEIGHT + state.dinoY;
  const dinoRect = {
    x: dinoX + 6,
    y: dinoScreenY + 4,
    w: DINO_WIDTH - 12,
    h: DINO_HEIGHT - 8,
  };

  for (const obs of state.obstacles) {
    if (obs.passed) continue;

    if (obs.type === "gap") {
      if (!dinoFellIntoGap(dinoRect, obs, groundY)) continue;

      obs.passed = true;
      state.phase = "falling";
      state.dinoReaction = "gap-fall";
      state.dinoReactionTimerMs = 0;
      state.isJumping = true;
      state.dinoVelocity = 0;
      state.screenShake = Math.max(state.screenShake, 5);
      return;
    }

  }

}

const DINO_HITBOX_INSET_X = 6;
const DINO_HITBOX_INSET_Y = 4;

function getDinoHitbox(state: GameState, groundY: number) {
  const dinoX = 80;
  const dinoScreenY = groundY - DINO_HEIGHT + state.dinoY;
  return {
    x: dinoX + DINO_HITBOX_INSET_X,
    y: dinoScreenY + DINO_HITBOX_INSET_Y,
    w: DINO_WIDTH - DINO_HITBOX_INSET_X * 2,
    h: DINO_HEIGHT - DINO_HITBOX_INSET_Y * 2,
    feetY: dinoScreenY + DINO_HEIGHT,
    centerX: dinoX + DINO_WIDTH / 2,
  };
}

function dinoOverlapsPlatformHorizontally(
  dinoLeft: number,
  dinoRight: number,
  platform: Platform,
): boolean {
  return dinoRight > platform.x + 4 && dinoLeft < platform.x + platform.width - 4;
}

/** Horizontal overlap including where the platform was one tick ago (scrolls left). */
function dinoOverlapsPlatformHorizontallySwept(
  dinoLeft: number,
  dinoRight: number,
  platform: Platform,
  sweepDistance: number,
): boolean {
  if (dinoOverlapsPlatformHorizontally(dinoLeft, dinoRight, platform)) return true;
  if (sweepDistance <= 0) return false;
  return dinoOverlapsPlatformHorizontally(dinoLeft, dinoRight, {
    ...platform,
    x: platform.x + sweepDistance,
  });
}

function tryLandOnPlatform(
  state: GameState,
  callbacks: EngineCallbacks,
  prevDinoY: number,
): boolean {
  if (!state.isJumping || state.dinoVelocity < 0) return false;

  const groundY = getGroundY(callbacks.canvasHeight);
  const prevFeetY = groundY + prevDinoY;
  const feetY = groundY + state.dinoY;
  const dino = getDinoHitbox(state, groundY);
  const dinoLeft = dino.x;
  const dinoRight = dino.x + dino.w;

  let bestPlatform: Platform | null = null;
  let bestElev = -Infinity;

  for (const platform of state.platforms) {
    if (
      !dinoOverlapsPlatformHorizontallySwept(
        dinoLeft,
        dinoRight,
        platform,
        state.speed,
      )
    ) {
      continue;
    }

    const surfaceTopY = groundY - platform.elev;
    const surfaceBottomY = surfaceTopY + PLATFORM_DRAW_HEIGHT;
    if (
      !shouldLandOnPlatformTop(
        prevFeetY,
        feetY,
        surfaceTopY,
        surfaceBottomY,
        PLATFORM_TOP_LANDING_TOLERANCE,
      )
    ) {
      continue;
    }

    if (platform.elev > bestElev) {
      bestElev = platform.elev;
      bestPlatform = platform;
    }
  }

  if (!bestPlatform) return false;

  state.dinoY = -bestPlatform.elev;
  state.dinoVelocity = 0;
  state.isJumping = false;
  spawnJumpParticles(state, dino.centerX, groundY - bestPlatform.elev);
  return true;
}

function tryBounceOffPlatformBottom(
  state: GameState,
  callbacks: EngineCallbacks,
  prevDinoY: number,
): boolean {
  if (!state.isJumping) return false;

  const movingUp = state.dinoY < prevDinoY;
  if (!movingUp) return false;

  const groundY = getGroundY(callbacks.canvasHeight);
  const prevDinoScreenY = groundY - DINO_HEIGHT + prevDinoY;
  const prevHeadY = prevDinoScreenY + DINO_HITBOX_INSET_Y;
  const prevFeetY = prevDinoScreenY + DINO_HEIGHT;
  const dino = getDinoHitbox(state, groundY);
  const headY = dino.y;
  const dinoHitbox = { x: dino.x, y: dino.y, w: dino.w, h: dino.h };
  const dinoLeft = dino.x;
  const dinoRight = dino.x + dino.w;

  let bestPlatform: Platform | null = null;
  let bestBottomY = -Infinity;

  for (const platform of state.platforms) {
    if (!dinoOverlapsPlatformHorizontally(dinoLeft, dinoRight, platform)) continue;

    const surfaceTopY = groundY - platform.elev;
    const surfaceBottomY = surfaceTopY + PLATFORM_DRAW_HEIGHT;
    const platformRect = {
      x: platform.x + 4,
      y: surfaceTopY,
      w: platform.width - 8,
      h: PLATFORM_DRAW_HEIGHT,
    };

    if (!rectsOverlap(dinoHitbox, platformRect)) continue;

    // Already jumped over the walkable top — not an underside hit.
    if (dino.feetY < surfaceTopY - 4) continue;

    // Approaching from below: feet stay at or under the walkable surface (larger screen Y).
    const fromBelow =
      prevFeetY >= surfaceTopY - PLATFORM_TOP_LANDING_TOLERANCE ||
      dino.feetY >= surfaceTopY - PLATFORM_TOP_LANDING_TOLERANCE;
    if (!fromBelow) continue;

    const crossedBottom = crossedUpIntoBottom(
      prevHeadY,
      headY,
      surfaceBottomY,
      PLATFORM_BOTTOM_HIT_TOLERANCE,
    );
    const insidePlatformBody =
      headY >= surfaceTopY - PLATFORM_BOTTOM_HIT_TOLERANCE &&
      headY <= surfaceBottomY + PLATFORM_BOTTOM_HIT_TOLERANCE;
    const passedThroughTop =
      prevHeadY >= surfaceTopY - PLATFORM_BOTTOM_HIT_TOLERANCE &&
      headY < surfaceTopY;

    if (!crossedBottom && !insidePlatformBody && !passedThroughTop) continue;

    if (surfaceBottomY > bestBottomY) {
      bestBottomY = surfaceBottomY;
      bestPlatform = platform;
    }
  }

  if (!bestPlatform) return false;

  state.dinoY = bestBottomY - DINO_HITBOX_INSET_Y - (groundY - DINO_HEIGHT);
  state.dinoVelocity = PLATFORM_BOTTOM_BOUNCE_VELOCITY;
  state.isJumping = true;
  spawnHitParticles(state, dino.centerX, bestBottomY, "#457EFF");
  return true;
}

function checkPlatformSupport(state: GameState, callbacks: EngineCallbacks) {
  if (state.phase !== "running" || state.isJumping || state.dinoY >= 0) return;

  const groundY = getGroundY(callbacks.canvasHeight);
  const dino = getDinoHitbox(state, groundY);
  const dinoLeft = dino.x;
  const dinoRight = dino.x + dino.w;
  const elevAboveGround = -state.dinoY;

  const supported = state.platforms.some((platform) => {
    const onPlatform = dinoOverlapsPlatformHorizontally(dinoLeft, dinoRight, platform);
    const atRightHeight = Math.abs(elevAboveGround - platform.elev) < 12;
    return onPlatform && atRightHeight;
  });

  if (!supported) {
    state.isJumping = true;
    state.dinoVelocity = Math.max(state.dinoVelocity, 1);
  }
}

function crossedDownOntoSurface(
  prevFeetY: number,
  feetY: number,
  surfaceTopY: number,
  tolerance: number,
): boolean {
  return prevFeetY <= surfaceTopY + 4 && feetY >= surfaceTopY - tolerance;
}

function shouldLandOnPlatformTop(
  prevFeetY: number,
  feetY: number,
  surfaceTopY: number,
  surfaceBottomY: number,
  tolerance: number,
): boolean {
  if (feetY < prevFeetY) return false;

  if (crossedDownOntoSurface(prevFeetY, feetY, surfaceTopY, tolerance)) {
    return true;
  }

  // Feet crossed the top before the platform scrolled under the dino, or we
  // partially tunnelled through the platform body — snap to the walkable top.
  if (feetY >= surfaceTopY - tolerance && prevFeetY <= surfaceTopY + tolerance) {
    return true;
  }

  // Full platform thickness crossed in one tick while descending from above.
  if (prevFeetY <= surfaceBottomY + tolerance && feetY >= surfaceTopY - tolerance) {
    return true;
  }

  return false;
}

function crossedUpIntoBottom(
  prevHeadY: number,
  headY: number,
  surfaceBottomY: number,
  tolerance: number,
): boolean {
  return prevHeadY >= surfaceBottomY - 4 && headY <= surfaceBottomY + tolerance;
}

/** Foot center past pit left edge plus margin, only if feet still overlap the pit. */
function dinoFellIntoGap(
  dinoRect: { x: number; y: number; w: number; h: number },
  gap: Obstacle,
  groundY: number,
): boolean {
  const feetY = dinoRect.y + dinoRect.h;
  const dinoRight = dinoRect.x + dinoRect.w;
  const pitLeft = gap.x;
  const pitRight = gap.x + gap.width;
  const overlapsPit = dinoRect.x < pitRight && dinoRight > pitLeft;
  const footCenterX = dinoRect.x + dinoRect.w / 2;
  const pastFallLine = footCenterX > pitLeft + GAP_FALL_MARGIN;
  return overlapsPit && pastFallLine && feetY > groundY - 10;
}

function finalizeGapFallIfOffScreen(state: GameState, callbacks: EngineCallbacks) {
  const groundY = getGroundY(callbacks.canvasHeight);
  const dinoTop = groundY - DINO_HEIGHT + state.dinoY;
  const margin = 24;
  if (dinoTop > callbacks.canvasHeight + margin) {
    state.phase = "game-over";
    state.isJumping = false;
    callbacks.onGameOver();
  }
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function spawnJumpParticles(state: GameState, x: number, y: number) {
  for (let i = 0; i < 6; i++) {
    state.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * -3 - 1,
      life: 20,
      maxLife: 20,
      color: "#457EFF",
      size: 2 + Math.random() * 2,
    });
  }
}

function spawnHitParticles(state: GameState, x: number, y: number, color: string) {
  for (let i = 0; i < 10; i++) {
    state.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      life: 30,
      maxLife: 30,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function updateParticles(state: GameState) {
  for (const p of state.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1;
    p.life--;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function updateClouds(state: GameState, canvasWidth: number) {
  for (const c of state.clouds) {
    c.x -= c.speed + (state.phase === "running" ? state.speed * 0.1 : 0);
    if (c.x + c.width < 0) {
      c.x = canvasWidth + Math.random() * 100;
      c.y = 30 + Math.random() * 100;
      c.width = 40 + Math.random() * 60;
    }
  }
}
