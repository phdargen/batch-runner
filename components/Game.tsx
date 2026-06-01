"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gameAudio } from "@/lib/game/audio";
import { createInitialState, tick, tryJump } from "@/lib/game/engine";
import type { EngineCallbacks } from "@/lib/game/engine";
import { render } from "@/lib/game/renderer";
import { JUMP_BUFFER_MS, GAME_VIEWPORT_HEIGHT, GAME_VIEWPORT_WIDTH, type GameState } from "@/lib/game/types";
import {
  applyCanvasViewport,
  computeViewportLayout,
  isPortraitMobile,
  tryLockLandscape,
  type ViewportLayout,
} from "@/lib/game/viewport";
import { JUMP_COST_UNITS, NEXT_DEV, roundBudgetUnits, VOUCHER_CHECKPOINT_JUMPS } from "@/lib/x402/config";
import { signGameVoucher } from "@/lib/x402/channel";
import type { SessionInfo } from "./DepositFlow";
import { GameHUD } from "./GameHUD";
import { GameOver } from "./GameOver";
import type { HighlightRun } from "./Leaderboard";

function jumpsFromBalance(balance: bigint): number {
  return Math.floor(Number(balance) / Number(JUMP_COST_UNITS));
}

type GameProps = {
  session: SessionInfo;
  onPlayAgain: () => void;
  onBackToDeposit: () => void;
  autoStart?: boolean;
};

function waitForVoucherSigningSlot(): Promise<void> {
  return new Promise(resolve => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => resolve(), { timeout: 250 });
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

export function Game({ session, onPlayAgain, onBackToDeposit, autoStart = false }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState>(createInitialState());
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const balanceRef = useRef(session.roundBudget);
  const cumulativeRef = useRef(session.chargedCumulativeAmount);
  const roundSpentRef = useRef(0n);
  const jumpCountRef = useRef(0);
  const jumpBufferMsRef = useRef(0);
  const jumpHeldRef = useRef(false);
  const jumpAttemptInFlightRef = useRef(false);
  const channelIdRef = useRef<`0x${string}` | null>(session.channelId);
  const checkpointInFlightRef = useRef<Promise<void> | null>(null);
  const jumpQueueRef = useRef<Promise<void>>(Promise.resolve());
  const voucherSigningQueueRef = useRef<Promise<void>>(Promise.resolve());
  const voucherSigningFailedRef = useRef(false);
  const devFrozenRef = useRef(false);
  const loopRef = useRef<(timestamp: number) => void>(() => {});
  const lastVoucherRef = useRef<{
    channelId: `0x${string}`;
    maxClaimableAmount: string;
    signature: `0x${string}`;
  } | null>(null);

  const maxJumps = jumpsFromBalance(roundBudgetUnits());
  const startingJumps = jumpsFromBalance(session.roundBudget);
  const [hudState, setHudState] = useState({
    distance: 0,
    remainingJumps: startingJumps,
  });
  const [gameOver, setGameOver] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const [highlightRun, setHighlightRun] = useState<HighlightRun | null>(null);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [started, setStarted] = useState(false);
  const [viewportLayout, setViewportLayout] = useState<ViewportLayout>({
    displayWidth: GAME_VIEWPORT_WIDTH,
    displayHeight: GAME_VIEWPORT_HEIGHT,
  });
  const [portraitBlocked, setPortraitBlocked] = useState(false);
  const startedRef = useRef(false);
  const prevIsJumpingRef = useRef(false);
  const prevPhaseRef = useRef<GameState["phase"]>("idle");

  const currentJumpCost = useCallback((): bigint => JUMP_COST_UNITS, []);

  const flushVoucherCheckpoint = useCallback(
    async (keepalive = false): Promise<void> => {
      if (NEXT_DEV) return Promise.resolve();

      await voucherSigningQueueRef.current;

      const cid = channelIdRef.current;
      const voucher = lastVoucherRef.current;
      if (!cid || !voucher || !session.channelConfig) return Promise.resolve();

      const body = JSON.stringify({
        channelConfig: session.channelConfig,
        voucher,
        jumpCount: jumpCountRef.current,
        distance: Math.floor(stateRef.current.distance),
        roundSpent: roundSpentRef.current.toString(),
      });

      const checkpoint = fetch("/api/game/voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
      }).then(response => {
        if (!response.ok) {
          throw new Error(`Voucher checkpoint failed (${response.status})`);
        }
      });

      const tracked = checkpoint
        .catch(err => {
          console.error("[batch-runner] Voucher checkpoint error:", err);
        })
        .finally(() => {
          if (checkpointInFlightRef.current === tracked) {
            checkpointInFlightRef.current = null;
          }
        });
      checkpointInFlightRef.current = tracked;

      return checkpointInFlightRef.current;
    },
    [session.channelConfig],
  );

  const handleJumpCost = useCallback((): boolean => {
    if (voucherSigningFailedRef.current) return false;
    const cost = currentJumpCost();
    if (balanceRef.current < cost) return false;

    const cid = channelIdRef.current;
    if (!cid || !session.channelConfig) return false;

    const nextCumulative = cumulativeRef.current + cost;
    balanceRef.current -= cost;
    cumulativeRef.current = nextCumulative;
    roundSpentRef.current += cost;
    jumpCountRef.current++;

    const signingTask = voucherSigningQueueRef.current
      .catch(() => {})
      // Let the jump state update render before mobile crypto work gets CPU time.
      .then(waitForVoucherSigningSlot)
      .then(async () => {
        const voucher = await signGameVoucher(session.voucherSigner, cid, nextCumulative);
        lastVoucherRef.current = voucher;

        await session.storage.set(cid, {
          balance: session.channelBalance.toString(),
          chargedCumulativeAmount: nextCumulative.toString(),
          signedMaxClaimable: nextCumulative.toString(),
          signature: voucher.signature,
        });
      })
      .catch(err => {
        voucherSigningFailedRef.current = true;
        console.error("[batch-runner] Voucher signing error:", err);
      });

    voucherSigningQueueRef.current = signingTask;

    if (jumpCountRef.current % VOUCHER_CHECKPOINT_JUMPS === 0) {
      void signingTask.then(() => {
        if (!voucherSigningFailedRef.current) return flushVoucherCheckpoint();
      });
    }

    return true;
  }, [
    currentJumpCost,
    flushVoucherCheckpoint,
    session.channelBalance,
    session.channelConfig,
    session.storage,
    session.voucherSigner,
  ]);

  const endGame = useCallback(() => {
    stateRef.current.phase = "game-over";
    gameAudio.playGameOver();
    setRank(null);
    setHighlightRun(null);
    setGameOver(true);
    setHudState(prev => ({
      ...prev,
      remainingJumps: jumpsFromBalance(balanceRef.current),
    }));
    cancelAnimationFrame(animRef.current);
    void flushVoucherCheckpoint(true);
  }, [flushVoucherCheckpoint]);

  const waitForJumpCooldown = useCallback((): Promise<void> => {
    return new Promise(resolve => {
      const wait = () => {
        const state = stateRef.current;
        if (state.phase === "game-over" || state.phase === "falling" || state.jumpCooldownMs <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      wait();
    });
  }, []);

  const attemptBufferedJump = useCallback(() => {
    if (jumpBufferMsRef.current <= 0) return;
    if (jumpAttemptInFlightRef.current) return;

    jumpAttemptInFlightRef.current = true;
    const attempt = jumpQueueRef.current
      .catch(() => {})
      .then(async () => {
        await waitForJumpCooldown();
        const jumped = await tryJump(stateRef.current, callbacks.current);
        if (jumped) {
          gameAudio.unlock();
          gameAudio.playJump();
          jumpBufferMsRef.current = 0;
        }
      })
      .finally(() => {
        jumpAttemptInFlightRef.current = false;
      });

    jumpQueueRef.current = attempt.then(() => undefined);
    void jumpQueueRef.current;
  }, [waitForJumpCooldown]);

  const callbacks = useRef<EngineCallbacks>({
    onJumpCost: () => false,
    onGameOver: () => {},
    canvasWidth: GAME_VIEWPORT_WIDTH,
    canvasHeight: GAME_VIEWPORT_HEIGHT,
  });

  useEffect(() => {
    callbacks.current = {
      onJumpCost: handleJumpCost,
      onGameOver: endGame,
      canvasWidth: GAME_VIEWPORT_WIDTH,
      canvasHeight: GAME_VIEWPORT_HEIGHT,
    };
  }, [handleJumpCost, endGame]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    const resizeCanvas = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const layout = computeViewportLayout(rect.width, rect.height);
      if (!layout) return;
      setViewportLayout(layout);
      applyCanvasViewport(canvas, layout);
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const container = containerRef.current;
    const resizeObserver = new ResizeObserver(resizeCanvas);
    if (container) resizeObserver.observe(container);

    const portraitQuery = window.matchMedia("(orientation: portrait) and (max-width: 900px)");
    const syncPortrait = () => setPortraitBlocked(isPortraitMobile());
    syncPortrait();
    portraitQuery.addEventListener("change", syncPortrait);

    const STEP = 16;
    const MAX_ACC = STEP * 4;
    const MAX_STEPS = 3;
    let acc = 0;

    const loop = (timestamp: number) => {
      if (NEXT_DEV && devFrozenRef.current) {
        return;
      }

      const frameDt = lastTimeRef.current ? timestamp - lastTimeRef.current : STEP;
      lastTimeRef.current = timestamp;
      acc = Math.min(acc + frameDt, MAX_ACC);

      const state = stateRef.current;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        if (state.phase !== "game-over") {
          tick(state, STEP, callbacks.current);
          jumpBufferMsRef.current = Math.max(0, jumpBufferMsRef.current - STEP);
          void attemptBufferedJump();

          if (prevIsJumpingRef.current && !state.isJumping && state.phase === "running") {
            gameAudio.playLanding();
          }
          if (prevPhaseRef.current !== "running" && state.phase === "running") {
            gameAudio.startLoop();
          }
          prevIsJumpingRef.current = state.isJumping;
          prevPhaseRef.current = state.phase;
        }
        acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS && acc >= STEP) {
        acc = 0;
      }

      if (state.phase !== "game-over") {
        const alpha = acc / STEP;
        render(ctx, state, alpha);

        if (state.frameCount % 10 === 0) {
          setHudState({
            distance: state.distance,
            remainingJumps: jumpsFromBalance(balanceRef.current),
          });
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };

    loopRef.current = loop;
    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resizeCanvas);
      resizeObserver.disconnect();
      portraitQuery.removeEventListener("change", syncPortrait);
      gameAudio.dispose();
      void flushVoucherCheckpoint(true);
    };
  }, [attemptBufferedJump, flushVoucherCheckpoint]);

  const toggleDevFreeze = useCallback(() => {
    if (!NEXT_DEV || !startedRef.current) return;
    if (devFrozenRef.current) {
      devFrozenRef.current = false;
      lastTimeRef.current = 0;
      animRef.current = requestAnimationFrame(loopRef.current);
    } else {
      devFrozenRef.current = true;
      cancelAnimationFrame(animRef.current);
    }
  }, []);

  useEffect(() => {
    if (!started) return;
    tryLockLandscape();
  }, [started]);

  useEffect(() => {
    if (!autoStart || startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
  }, [autoStart]);

  // Input handling
  useEffect(() => {
    const queueJumpInput = () => {
      gameAudio.unlock();
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
      }
      if (stateRef.current.phase === "game-over") return;
      if (jumpHeldRef.current) return;
      jumpBufferMsRef.current = JUMP_BUFFER_MS;
      jumpHeldRef.current = true;
    };

    const releaseJumpInput = () => {
      jumpHeldRef.current = false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (NEXT_DEV && e.code === "KeyP") {
        if (e.repeat) return;
        e.preventDefault();
        toggleDevFreeze();
        return;
      }
      if (e.code !== "Space" && e.code !== "ArrowUp") return;
      e.preventDefault();
      if (e.repeat) return;
      queueJumpInput();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        releaseJumpInput();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (stateRef.current.phase === "game-over") return;
      if ((e.target as Element).closest(".game-over-shell")) return;
      e.preventDefault();
      queueJumpInput();
    };

    const handlePageHide = () => {
      void flushVoucherCheckpoint(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("pointerup", releaseJumpInput);
    window.addEventListener("pointercancel", releaseJumpInput);
    window.addEventListener("pagehide", handlePageHide);

    const viewport = viewportRef.current;
    viewport?.addEventListener("pointerdown", handlePointerDown, { passive: false });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("pointerup", releaseJumpInput);
      window.removeEventListener("pointercancel", releaseJumpInput);
      window.removeEventListener("pagehide", handlePageHide);
      viewport?.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [flushVoucherCheckpoint, toggleDevFreeze]);

  const handleSubmitScore = useCallback(async () => {
    const state = stateRef.current;
    await flushVoucherCheckpoint();
    const res = await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: session.playerAddress,
        distance: Math.floor(state.distance),
        voucherCount: jumpCountRef.current,
        lastVoucher: lastVoucherRef.current,
        signerAddress: session.sessionAddress,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setRank(data.rank ?? null);
      setHighlightRun({
        address: session.playerAddress,
        distance: Math.floor(state.distance),
        voucherCount: jumpCountRef.current,
      });
      setLeaderboardRefreshKey(key => key + 1);
    }
  }, [flushVoucherCheckpoint, session.playerAddress, session.sessionAddress]);

  useEffect(() => {
    if (!gameOver) return;
    void handleSubmitScore();
  }, [gameOver, handleSubmitScore]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden"
    >
      {portraitBlocked && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-surface)]">
          <div className="text-center px-8 animate-slide-up">
            <p className="text-4xl mb-4">📱</p>
            <p className="text-sm font-bold">Rotate your device</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-2">
              Batch Runner is played in landscape
            </p>
          </div>
        </div>
      )}

      <div
        ref={viewportRef}
        className="game-viewport relative shrink-0 overflow-hidden"
        style={{
          width: viewportLayout.displayWidth,
          height: viewportLayout.displayHeight,
          touchAction: "none",
        }}
      >
        <GameHUD
          distance={hudState.distance}
          remainingJumps={hudState.remainingJumps}
          maxJumps={maxJumps}
        />

        <canvas ref={canvasRef} className="block" />

        {!started && !gameOver && !portraitBlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] z-10">
            <div className="text-center animate-slide-up">
              <p className="text-lg font-bold text-white mb-2">Press SPACE, click, or tap to start</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Each jump costs $0.001. Jump over gaps to stay on the chain.
              </p>
            </div>
          </div>
        )}

        {gameOver && (
          <GameOver
            distance={stateRef.current.distance}
            voucherCount={jumpCountRef.current}
            rank={rank}
            highlightRun={highlightRun}
            leaderboardRefreshKey={leaderboardRefreshKey}
            onPlayAgain={onPlayAgain}
            onBackToDeposit={onBackToDeposit}
          />
        )}
      </div>
    </div>
  );
}
