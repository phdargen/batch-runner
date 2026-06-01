import type { GameState, VisualZone } from "./types";
import { DINO_WIDTH, DINO_HEIGHT, GAME_VIEWPORT_HEIGHT, GAME_VIEWPORT_WIDTH } from "./types";
import { drawDino, drawPlatformSet, drawNyBackground, drawGlowFloor, getGroundY } from "./sprites";

function getVisualZone(distance: number): VisualZone {
  if (distance < 2000) return "calm";
  if (distance < 5000) return "dusk";
  if (distance < 7000) return "night";
  return "overdrive";
}

function getBackgroundGradient(
  ctx: CanvasRenderingContext2D,
  zone: VisualZone,
  height: number,
): CanvasGradient {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  switch (zone) {
    case "calm":
      grad.addColorStop(0, "#1a1a3e");
      grad.addColorStop(1, "#0f0f28");
      break;
    case "dusk":
      grad.addColorStop(0, "#14142e");
      grad.addColorStop(1, "#0a0a1a");
      break;
    case "night":
      grad.addColorStop(0, "#0c0c1e");
      grad.addColorStop(1, "#050510");
      break;
    case "overdrive":
      grad.addColorStop(0, "#060612");
      grad.addColorStop(1, "#020208");
      break;
  }
  return grad;
}

/**
 * Draws the current frame. `alpha` is the fraction (0..1) of a fixed simulation
 * step that has elapsed since the last `tick`, used to extrapolate moving
 * entities so motion stays smooth on displays whose refresh rate does not match
 * the fixed timestep (e.g. 120Hz mobile screens). It never affects game logic.
 */
export function render(ctx: CanvasRenderingContext2D, state: GameState, alpha = 0) {
  const width = GAME_VIEWPORT_WIDTH;
  const height = GAME_VIEWPORT_HEIGHT;
  const groundY = getGroundY(height);
  const zone = getVisualZone(state.distance);

  // The world only scrolls while running, so only extrapolate the scroll then.
  const scrollShift = state.phase === "running" ? alpha * state.speed : 0;
  const groundScroll = state.groundOffset + scrollShift;

  ctx.save();

  // Screen shake in overdrive
  if (state.screenShake > 0) {
    const shakeX = (Math.random() - 0.5) * state.screenShake;
    const shakeY = (Math.random() - 0.5) * state.screenShake;
    ctx.translate(shakeX, shakeY);
  }

  const hasNyBackground = drawNyBackground(ctx, width, height, groundScroll);
  if (!hasNyBackground) {
    ctx.fillStyle = getBackgroundGradient(ctx, zone, height);
    ctx.fillRect(0, 0, width, height);
  }

  // Speed lines (night + overdrive, skyline only)
  if (zone === "night" || zone === "overdrive") {
    ctx.save();
    ctx.strokeStyle = zone === "overdrive" ? "rgba(69,126,255,0.15)" : "rgba(69,126,255,0.07)";
    ctx.lineWidth = 1;
    const lineCount = zone === "overdrive" ? 12 : 5;
    for (let i = 0; i < lineCount; i++) {
      const lineY = (((state.frameCount * 3 + i * 97) % groundY) + groundY) % groundY;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(width * 0.3, lineY);
      ctx.stroke();
    }
    ctx.restore();
  }

  const floorGaps = state.obstacles
    .filter((obs) => obs.type === "gap")
    .map((obs) => ({ x: obs.x - scrollShift, width: obs.width }));

  drawFloorWithGaps(ctx, width, groundY, height, floorGaps, () => {
    drawGlowFloor(ctx, width, groundY, groundScroll);
  });

  // Floating platforms
  for (const platform of state.platforms) {
    drawPlatformSet(ctx, platform.x - scrollShift, groundY, platform.elev, platform.tileCount);
  }

  // Dino: interpolate between the previous and current simulated positions.
  // Extrapolating instead would overshoot the ground/platform on the landing
  // tick (when dinoY is hard-clamped) and cause a visible snap.
  const dinoX = 80;
  const dinoY = state.prevDinoY + alpha * (state.dinoY - state.prevDinoY);
  const dinoScreenY = groundY - DINO_HEIGHT + dinoY;
  drawDino(
    ctx,
    dinoX,
    dinoScreenY,
    getDinoSpriteFrame(state),
  );

  // Particles
  for (const p of state.particles) {
    ctx.save();
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    const px = p.x + alpha * p.vx;
    const py = p.y + alpha * p.vy;
    ctx.fillRect(px - p.size / 2, py - p.size / 2, p.size, p.size);
    ctx.restore();
  }

  ctx.restore();
}

function getDinoSpriteFrame(state: GameState): number {
  if (state.dinoReaction === "gap-fall") return 7;
  if (!state.isJumping) return state.runFrame;
  if (state.jumpCooldownMs <= 0) return 4;
  return 3;
}

function drawFloorWithGaps(
  ctx: CanvasRenderingContext2D,
  width: number,
  groundY: number,
  height: number,
  gaps: Array<{ x: number; width: number }>,
  drawFloor: () => void,
) {
  if (gaps.length === 0) {
    drawFloor();
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, groundY, width, height - groundY);
  for (const gap of gaps) {
    ctx.rect(gap.x, groundY, gap.width, height - groundY);
  }
  ctx.clip("evenodd");
  drawFloor();
  ctx.restore();
}
