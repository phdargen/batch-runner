import type { GameState, VisualZone } from "./types";
import { GROUND_Y, DINO_WIDTH, DINO_HEIGHT } from "./types";
import { drawDino, drawBank, drawNyBackground, drawNyFloor } from "./sprites";

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

function getPitVoidGradient(
  ctx: CanvasRenderingContext2D,
  groundY: number,
  height: number,
): CanvasGradient {
  const grad = ctx.createLinearGradient(0, groundY, 0, height);
  grad.addColorStop(0, "#0f0f28");
  grad.addColorStop(1, "#020208");
  return grad;
}

function getGroundGlow(zone: VisualZone): { color: string; alpha: number } {
  switch (zone) {
    case "calm":
      return { color: "#0052FF", alpha: 0.3 };
    case "dusk":
      return { color: "#0052FF", alpha: 0.5 };
    case "night":
      return { color: "#457EFF", alpha: 0.7 };
    case "overdrive":
      return { color: "#457EFF", alpha: 0.9 };
  }
}

export function render(ctx: CanvasRenderingContext2D, state: GameState) {
  const { width, height } = ctx.canvas;
  const groundY = Math.floor(height * GROUND_Y);
  const zone = getVisualZone(state.distance);

  ctx.save();

  // Screen shake in overdrive
  if (state.screenShake > 0) {
    const shakeX = (Math.random() - 0.5) * state.screenShake;
    const shakeY = (Math.random() - 0.5) * state.screenShake;
    ctx.translate(shakeX, shakeY);
  }

  const hasNyBackground = drawNyBackground(ctx, width, groundY, state.groundOffset);
  if (!hasNyBackground) {
    ctx.fillStyle = getBackgroundGradient(ctx, "calm", groundY);
    ctx.fillRect(0, 0, width, groundY);
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

  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, groundY, width, height - groundY);

  const floorGaps = state.obstacles
    .filter((obs) => obs.type === "gap")
    .map((obs) => ({ x: obs.x, width: obs.width }));

  drawFloorWithGaps(ctx, width, groundY, height, floorGaps, () => {
    const hasNyFloor = drawNyFloor(ctx, width, groundY, height, state.groundOffset);
    if (!hasNyFloor) {
      const glow = getGroundGlow("calm");
      ctx.save();
      ctx.strokeStyle = glow.color;
      ctx.globalAlpha = glow.alpha;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();

      ctx.globalAlpha = glow.alpha * 0.5;
      ctx.lineWidth = 1;
      const dashLen = 20;
      const gapLen = 30;
      const offset = state.groundOffset % (dashLen + gapLen);
      for (let x = -offset; x < width; x += dashLen + gapLen) {
        ctx.beginPath();
        ctx.moveTo(x, groundY + 8);
        ctx.lineTo(x + dashLen, groundY + 8);
        ctx.stroke();
      }
      ctx.restore();
    }
  });

  if (floorGaps.length > 0) {
    ctx.fillStyle = getPitVoidGradient(ctx, groundY, height);
    for (const gap of floorGaps) {
      ctx.fillRect(gap.x, groundY, gap.width, height - groundY);
    }
  }

  // Obstacles
  for (const obs of state.obstacles) {
    if (obs.type === "bank") {
      drawBank(ctx, obs.x, groundY - obs.height);
    }
  }

  // Dino
  const dinoX = 80;
  const dinoScreenY = groundY - DINO_HEIGHT + state.dinoY;
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
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }

  ctx.restore();
}

function getDinoSpriteFrame(state: GameState): number {
  if (state.dinoReaction === "gap-fall") return 7;
  if (state.dinoReaction === "obstacle-hit") return 6;
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
