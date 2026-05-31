import { DINO_HEIGHT, DINO_WIDTH } from "./types";

/**
 * Pixel art rendering functions for game entities.
 * All sprites use a consistent retro pixel style with Base blue (#0052FF) as the primary color.
 */

const BASE_BLUE = "#0052FF";
const BASE_BLUE_LIGHT = "#457EFF";
const BASE_BLUE_DARK = "#003ECF";
const DINO_SPRITE_COLUMNS = 4;
const DINO_SPRITE_FRAME_COUNT = 8;
const DINO_SPRITE_CELL_WIDTH = 444;
const DINO_SPRITE_CELL_HEIGHT = 444;
const DINO_SPRITE_SRC = "/dino.png";
const DINO_WALK_SPRITE_SRC = "/dino3.png";
const DINO_WALK_FRAME_COUNT = 3;
const DINO_SPRITE_DRAW_HEIGHT = 56;
const NY_BACKGROUND_SRC = "/ny.png";
const FLOOR_NY_SRC = "/floor_ny.png";
const FLOOR_NY_SOURCE_X = 0;
const FLOOR_NY_SOURCE_Y = 346;
const FLOOR_NY_SOURCE_WIDTH = 2508;
const FLOOR_NY_SOURCE_HEIGHT = 182;
const BANK_SPRITE_SRC = "/bank.png";
const BANK_SOURCE_X = 193;
const BANK_SOURCE_Y = 286;
const BANK_SOURCE_WIDTH = 868;
const BANK_SOURCE_HEIGHT = 673;
const NY_BACKGROUND_PARALLAX = 0.22;

export const BANK_DRAW_WIDTH = 216;
export const BANK_DRAW_HEIGHT = Math.round(BANK_DRAW_WIDTH * (BANK_SOURCE_HEIGHT / BANK_SOURCE_WIDTH));

type DinoFrameBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DINO_FRAME_BOUNDS: DinoFrameBounds[] = [
  { x: 59, y: 101, width: 328, height: 248 },
  { x: 47, y: 98, width: 298, height: 251 },
  { x: 17, y: 101, width: 315, height: 251 },
  { x: 43, y: 79, width: 291, height: 252 },
  { x: 125, y: 30, width: 241, height: 248 },
  { x: 53, y: 31, width: 295, height: 258 },
  { x: 73, y: 0, width: 262, height: 302 },
  { x: 50, y: 32, width: 247, height: 267 },
];

/** Uniform on-screen width for all dino3 walk frames. */
const DINO_WALK_DRAW_WIDTH =
  DINO_SPRITE_DRAW_HEIGHT * (DINO_FRAME_BOUNDS[0].width / DINO_FRAME_BOUNDS[0].height);

/** Vertical trim within each 724px column (feet aligned at bottom). */
const DINO_WALK_TRIM_Y = [87, 87, 87];
const DINO_WALK_TRIM_HEIGHT = [495, 494, 494];

const spriteCache = new Map<string, HTMLImageElement>();

function getSprite(src: string): HTMLImageElement | null {
  if (typeof window === "undefined") return null;

  let sprite = spriteCache.get(src);
  if (!sprite) {
    sprite = new window.Image();
    sprite.src = src;
    spriteCache.set(src, sprite);
  }

  if (!sprite.complete || sprite.naturalWidth === 0) return null;
  return sprite;
}

function getDinoSprite(): HTMLImageElement | null {
  return getSprite(DINO_SPRITE_SRC);
}

function getDinoWalkSprite(): HTMLImageElement | null {
  return getSprite(DINO_WALK_SPRITE_SRC);
}

function tilePixelImage(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLImageElement,
  scrollOffset: number,
  canvasWidth: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const w = Math.round(tileWidth);
  const h = Math.round(tileHeight);
  const offset = ((scrollOffset % w) + w) % w;
  let drawX = Math.floor(x - offset);
  while (drawX < canvasWidth) {
    ctx.drawImage(sprite, drawX, Math.floor(y), w, h);
    drawX += w;
  }
  ctx.restore();
}

function tilePixelImageSource(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  scrollOffset: number,
  canvasWidth: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const w = Math.round(tileWidth);
  const h = Math.round(tileHeight);
  const offset = ((scrollOffset % w) + w) % w;
  let drawX = Math.floor(x - offset);
  while (drawX < canvasWidth) {
    ctx.drawImage(
      sprite,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      drawX,
      Math.floor(y),
      w,
      h,
    );
    drawX += w;
  }
  ctx.restore();
}

function getDinoDrawWidth(bounds: DinoFrameBounds): number {
  return DINO_SPRITE_DRAW_HEIGHT * (bounds.width / bounds.height);
}

function drawDinoSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sprite: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  drawWidth: number,
) {
  const drawX = x + DINO_WIDTH / 2 - drawWidth / 2;
  const drawY = y + DINO_HEIGHT - DINO_SPRITE_DRAW_HEIGHT;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    sprite,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    drawX,
    drawY,
    drawWidth,
    DINO_SPRITE_DRAW_HEIGHT,
  );
  ctx.restore();
}

function drawDinoWalkFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
) {
  const sprite = getDinoWalkSprite();
  if (!sprite) return;

  const safeFrame = ((frame % DINO_WALK_FRAME_COUNT) + DINO_WALK_FRAME_COUNT) % DINO_WALK_FRAME_COUNT;
  const colWidth = Math.floor(sprite.naturalWidth / DINO_WALK_FRAME_COUNT);
  const sourceX = safeFrame * colWidth;
  const sourceWidth =
    safeFrame === DINO_WALK_FRAME_COUNT - 1 ? sprite.naturalWidth - sourceX : colWidth;

  drawDinoSprite(
    ctx,
    x,
    y,
    sprite,
    sourceX,
    DINO_WALK_TRIM_Y[safeFrame]!,
    sourceWidth,
    DINO_WALK_TRIM_HEIGHT[safeFrame]!,
    DINO_WALK_DRAW_WIDTH,
  );
}

function drawDinoAtlasFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
) {
  const sprite = getDinoSprite();
  if (!sprite) return;

  const safeFrame = ((frame % DINO_SPRITE_FRAME_COUNT) + DINO_SPRITE_FRAME_COUNT) % DINO_SPRITE_FRAME_COUNT;
  const frameBounds = DINO_FRAME_BOUNDS[safeFrame];
  const sourceX = (safeFrame % DINO_SPRITE_COLUMNS) * DINO_SPRITE_CELL_WIDTH + frameBounds.x;
  const sourceY = Math.floor(safeFrame / DINO_SPRITE_COLUMNS) * DINO_SPRITE_CELL_HEIGHT + frameBounds.y;

  drawDinoSprite(
    ctx,
    x,
    y,
    sprite,
    sourceX,
    sourceY,
    frameBounds.width,
    frameBounds.height,
    getDinoDrawWidth(frameBounds),
  );
}

export function drawDino(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
) {
  if (frame >= 0 && frame < DINO_WALK_FRAME_COUNT) {
    const walkSprite = getDinoWalkSprite();
    if (walkSprite) {
      drawDinoWalkFrame(ctx, x, y, frame);
      return;
    }
    drawDinoAtlasFrame(ctx, x, y, frame);
    return;
  }

  drawDinoAtlasFrame(ctx, x, y, frame);
}

export function drawGasPump(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const p = 3;
  ctx.save();
  ctx.translate(x, y);

  // Base
  ctx.fillStyle = "#555566";
  ctx.fillRect(2 * p, 10 * p, 8 * p, 6 * p);

  // Body
  ctx.fillStyle = "#ff6b35";
  ctx.fillRect(3 * p, 3 * p, 6 * p, 7 * p);

  // Nozzle top
  ctx.fillStyle = "#333344";
  ctx.fillRect(4 * p, 0, 4 * p, 3 * p);

  // Hose
  ctx.fillStyle = "#333344";
  ctx.fillRect(0, 4 * p, 3 * p, 2 * p);
  ctx.fillRect(0, 4 * p, 1 * p, 5 * p);

  // Screen/meter
  ctx.fillStyle = "#00d68f";
  ctx.fillRect(4 * p, 5 * p, 4 * p, 3 * p);

  // Dollar sign on screen
  ctx.fillStyle = "#003322";
  ctx.fillRect(5 * p, 5 * p, 2 * p, 1 * p);
  ctx.fillRect(5 * p, 7 * p, 2 * p, 1 * p);
  ctx.fillRect(5 * p, 6 * p, 1 * p, 1 * p);
  ctx.fillRect(6 * p, 6 * p, 1 * p, 1 * p);

  ctx.restore();
}

export function drawNyBackground(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  skyHeight: number,
  scrollOffset: number,
): boolean {
  const sprite = getSprite(NY_BACKGROUND_SRC);
  if (!sprite) return false;

  const drawHeight = Math.round(skyHeight);
  const drawWidth = Math.round((sprite.naturalWidth / sprite.naturalHeight) * drawHeight);
  tilePixelImage(
    ctx,
    sprite,
    Math.floor(scrollOffset * NY_BACKGROUND_PARALLAX),
    canvasWidth,
    0,
    0,
    drawWidth,
    drawHeight,
  );
  return true;
}

export function drawNyFloor(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  groundY: number,
  canvasHeight: number,
  scrollOffset: number,
): boolean {
  const sprite = getSprite(FLOOR_NY_SRC);
  if (!sprite) return false;

  const drawHeight = canvasHeight - groundY;
  const tileWidth = (FLOOR_NY_SOURCE_WIDTH / FLOOR_NY_SOURCE_HEIGHT) * drawHeight;
  tilePixelImageSource(
    ctx,
    sprite,
    FLOOR_NY_SOURCE_X,
    FLOOR_NY_SOURCE_Y,
    FLOOR_NY_SOURCE_WIDTH,
    FLOOR_NY_SOURCE_HEIGHT,
    Math.floor(scrollOffset),
    canvasWidth,
    0,
    groundY,
    tileWidth,
    drawHeight,
  );
  return true;
}

export function drawBank(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const sprite = getSprite(BANK_SPRITE_SRC);
  if (!sprite) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite,
    BANK_SOURCE_X,
    BANK_SOURCE_Y,
    BANK_SOURCE_WIDTH,
    BANK_SOURCE_HEIGHT,
    x,
    y,
    BANK_DRAW_WIDTH,
    BANK_DRAW_HEIGHT,
  );
  ctx.restore();
}

export function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  opacity: number,
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = "#ffffff";
  const h = width * 0.4;
  ctx.beginPath();
  ctx.ellipse(x + width * 0.3, y + h * 0.5, width * 0.3, h * 0.5, 0, 0, Math.PI * 2);
  ctx.ellipse(x + width * 0.6, y + h * 0.3, width * 0.25, h * 0.45, 0, 0, Math.PI * 2);
  ctx.ellipse(x + width * 0.8, y + h * 0.55, width * 0.2, h * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawJumpSparkle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const sparkles = [
    { dx: -8, dy: 4, size: 3 },
    { dx: 8, dy: -2, size: 2 },
    { dx: -4, dy: -8, size: 2.5 },
    { dx: 12, dy: 6, size: 2 },
  ];
  ctx.save();
  ctx.fillStyle = BASE_BLUE_LIGHT;
  for (const s of sparkles) {
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x + s.dx - s.size / 2, y + s.dy - s.size / 2, s.size, s.size);
  }
  ctx.restore();
}
