import type { GameState, Obstacle, Cloud, ObstacleType, GamePhase } from "./types";
import { BANK_DRAW_WIDTH, BANK_DRAW_HEIGHT } from "./sprites";
import {
  GROUND_Y,
  DINO_WIDTH,
  DINO_HEIGHT,
  GRAVITY,
  JUMP_VELOCITY,
  BASE_SPEED,
  MAX_SPEED,
  SPEED_INCREMENT,
  OBSTACLE_MIN_GAP,
  JUMP_COOLDOWN_MS,
  BANK_PENALTY_JUMPS,
  BANK_TOP_BOUNCE_VELOCITY,
  BANK_TOP_LANDING_TOLERANCE,
  MAX_FALL_VELOCITY,
  GAP_FALL_MARGIN,
  HAZARD_GAP_BONUS,
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
    particles: [],
    clouds: initClouds(),
    groundOffset: 0,
    frameCount: 0,
    jumpCooldownMs: 0,
    topJumpLocked: false,
    bankPenaltyJumpsLeft: 0,
    screenShake: 0,
    lastObstacleDistance: 0,
    lastObstacleType: null,
    gapForbiddenSlots: 0,
    bankForbiddenSlots: 0,
    runFrame: 0,
    runFrameTimer: 0,
    dinoReaction: "none",
    dinoReactionTimerMs: 0,
  };
}

function initClouds(): Cloud[] {
  return Array.from({ length: 5 }, () => ({
    x: Math.random() * 800,
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

  spawnJumpParticles(state, 80 + DINO_WIDTH / 2, callbacks.canvasHeight * GROUND_Y + state.dinoY);
  return true;
}

export function tick(state: GameState, dt: number, callbacks: EngineCallbacks): GameState {
  if (state.phase === "idle" || state.phase === "game-over") {
    updateClouds(state, callbacks.canvasWidth);
    advanceRunFrame(state, dt);
    state.frameCount++;
    return state;
  }

  // Speed ramp & score only while actually running (not during pit fall)
  if (state.phase === "running") {
    state.speed = Math.min(MAX_SPEED, state.speed + SPEED_INCREMENT * dt);
    state.distance += state.speed * (dt / 16);
    maybeSpawnObstacle(state, callbacks);
    state.groundOffset += state.speed;
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
    state.dinoY += state.dinoVelocity;
    const descendingOrGrounded = state.dinoVelocity >= 0;
    const landed =
      state.phase !== "falling" && state.dinoY >= 0 && descendingOrGrounded;
    if (landed) {
      state.dinoY = 0;
      state.dinoVelocity = 0;
      state.isJumping = false;
    }
  }

  updateTopJumpLock(state, callbacks);

  if (state.phase === "running") {
    advanceRunFrame(state, dt);
  }

  // Move obstacles (frozen horizontally while falling straight down)
  if (state.phase === "running") {
    for (const obs of state.obstacles) {
      obs.x -= state.speed;
    }
  }

  // Collision detection
  checkCollisions(state, callbacks);

  if (state.phase === "falling") {
    finalizeGapFallIfOffScreen(state, callbacks);
  }

  // Cull offscreen obstacles
  state.obstacles = state.obstacles.filter((o) => o.x + o.width > -50);

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

  const groundY = callbacks.canvasHeight * GROUND_Y;
  const dinoScreenY = groundY - DINO_HEIGHT + state.dinoY;

  if (dinoScreenY < 0) {
    state.topJumpLocked = true;
  } else if (state.topJumpLocked) {
    state.topJumpLocked = false;
  }
}

function maybeSpawnObstacle(state: GameState, callbacks: EngineCallbacks) {
  let gap = getObstacleGap(state.distance);
  if (state.gapForbiddenSlots > 0 || state.bankForbiddenSlots > 0) {
    gap += HAZARD_GAP_BONUS;
  }
  if (state.distance - state.lastObstacleDistance < gap) return;

  const gapsForbidden = state.gapForbiddenSlots > 0;
  const banksForbidden = state.bankForbiddenSlots > 0;
  if (state.gapForbiddenSlots > 0) {
    state.gapForbiddenSlots--;
  }
  if (state.bankForbiddenSlots > 0) {
    state.bankForbiddenSlots--;
  }

  const type = chooseObstacleType(state.distance, gapsForbidden, banksForbidden);
  if (!type) {
    state.lastObstacleDistance = state.distance;
    return;
  }

  const obs: Obstacle = {
    type,
    x: callbacks.canvasWidth + 20,
    y: 0,
    width: getObstacleWidth(type, state.distance),
    height: type === "gap" ? 0 : type === "bank" ? BANK_DRAW_HEIGHT : 48,
    passed: false,
  };

  state.obstacles.push(obs);
  state.lastObstacleDistance = state.distance;
  state.lastObstacleType = type;

  if (type === "gap") {
    state.bankForbiddenSlots = Math.max(state.bankForbiddenSlots, BANK_GAP_NEAR_SPAWN_SLOTS);
  } else if (type === "bank") {
    state.gapForbiddenSlots = Math.max(state.gapForbiddenSlots, BANK_GAP_NEAR_SPAWN_SLOTS);
  }
}

const GAP_SPAWN_CHANCE = 0.38;
const BANK_SPAWN_CHANCE = 0.12;
const EARLY_BANK_SPAWN_CHANCE = 0.1;
const EARLY_GAME_DISTANCE = 700;
const BANK_GAP_NEAR_SPAWN_SLOTS = 2;

function chooseObstacleType(
  distance: number,
  gapsForbidden: boolean,
  banksForbidden: boolean,
): ObstacleType | null {
  if (distance < EARLY_GAME_DISTANCE) {
    if (!banksForbidden && Math.random() < EARLY_BANK_SPAWN_CHANCE) return "bank";
    return null;
  }

  if (!gapsForbidden && Math.random() < GAP_SPAWN_CHANCE) return "gap";
  if (!banksForbidden && Math.random() < BANK_SPAWN_CHANCE) return "bank";
  return null;
}

function getObstacleWidth(type: ObstacleType, distance: number): number {
  if (type === "bank") return BANK_DRAW_WIDTH;

  const difficultyBonus = Math.min(50, distance / 180);
  return 70 + Math.random() * 35 + difficultyBonus;
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
  const groundY = callbacks.canvasHeight * GROUND_Y;
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

    if (obs.type !== "bank") continue;

    const obsRect = {
      x: obs.x + 4,
      y: groundY - obs.height + 4,
      w: obs.width - 8,
      h: obs.height - 4,
    };

    if (!rectsOverlap(dinoRect, obsRect)) continue;

    obs.passed = true;

    const bankTopY = obsRect.y;
    const dinoFeetY = dinoRect.y + dinoRect.h;

    if (isLandingOnBankTop(state, dinoFeetY, bankTopY)) {
      state.dinoY += bankTopY - dinoFeetY;
      state.dinoVelocity = BANK_TOP_BOUNCE_VELOCITY;
      state.isJumping = true;
      spawnJumpParticles(state, dinoX + DINO_WIDTH / 2, bankTopY);
      continue;
    }

    state.bankPenaltyJumpsLeft = BANK_PENALTY_JUMPS;
    state.dinoReaction = "obstacle-hit";
    state.dinoReactionTimerMs = 450;
    spawnHitParticles(state, obs.x, groundY - obs.height / 2, "#00d68f");
  }
}

/** Feet crossing down onto the bank roof while airborne — not a side hit at ground level. */
function isLandingOnBankTop(
  state: GameState,
  dinoFeetY: number,
  bankTopY: number,
): boolean {
  if (!state.isJumping || state.dinoVelocity < 0) return false;

  const prevFeetY = dinoFeetY - state.dinoVelocity;
  return (
    prevFeetY <= bankTopY + 4 &&
    dinoFeetY >= bankTopY - BANK_TOP_LANDING_TOLERANCE
  );
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
  const groundY = callbacks.canvasHeight * GROUND_Y;
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
