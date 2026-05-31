"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createInitialState, tick, tryJump } from "@/lib/game/engine";
import type { EngineCallbacks } from "@/lib/game/engine";
import { render } from "@/lib/game/renderer";
import { JUMP_BUFFER_MS, type GameState } from "@/lib/game/types";
import { JUMP_COST_UNITS, NEXT_DEV, VOUCHER_CHECKPOINT_JUMPS } from "@/lib/x402/config";
import { signGameVoucher, verifyGameVoucher } from "@/lib/x402/channel";
import type { SessionInfo } from "./DepositFlow";
import { GameHUD } from "./GameHUD";
import { GameOver } from "./GameOver";

type GameProps = {
  session: SessionInfo;
  onPlayAgain: () => void;
};

export function Game({ session, onPlayAgain }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const jumpPaymentInFlightRef = useRef(false);
  const jumpQueueRef = useRef<Promise<void>>(Promise.resolve());
  const devFrozenRef = useRef(false);
  const loopRef = useRef<(timestamp: number) => void>(() => {});
  const lastVoucherRef = useRef<{
    channelId: `0x${string}`;
    maxClaimableAmount: string;
    signature: `0x${string}`;
  } | null>(null);

  const [hudState, setHudState] = useState({
    balance: Number(balanceRef.current),
    distance: 0,
    voucherCount: 0,
  });
  const [gameOver, setGameOver] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);

  const currentJumpCost = useCallback((): bigint => JUMP_COST_UNITS, []);

  const flushVoucherCheckpoint = useCallback(
    (keepalive = false): Promise<void> => {
      if (NEXT_DEV) return Promise.resolve();

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

  const handleJumpCost = useCallback(async (): Promise<boolean> => {
    if (jumpPaymentInFlightRef.current) return false;

    const cost = currentJumpCost();
    if (balanceRef.current < cost) return false;

    const cid = channelIdRef.current;
    if (!cid || !session.channelConfig) return false;

    jumpPaymentInFlightRef.current = true;
    let voucher: {
      channelId: `0x${string}`;
      maxClaimableAmount: string;
      signature: `0x${string}`;
    };
    const nextCumulative = cumulativeRef.current + cost;
    try {
      voucher = await signGameVoucher(session.voucherSigner, cid, nextCumulative);
      const validVoucher = await verifyGameVoucher(session.sessionAddress, voucher);
      if (!validVoucher) return false;
    } catch (err) {
      console.error("[batch-runner] Voucher signing error:", err);
      return false;
    } finally {
      jumpPaymentInFlightRef.current = false;
    }

    balanceRef.current -= cost;
    cumulativeRef.current = nextCumulative;
    roundSpentRef.current += cost;
    jumpCountRef.current++;

    lastVoucherRef.current = voucher;
    void session.storage.set(cid, {
      balance: session.channelBalance.toString(),
      chargedCumulativeAmount: cumulativeRef.current.toString(),
      signedMaxClaimable: cumulativeRef.current.toString(),
      signature: voucher.signature,
    });

    if (jumpCountRef.current % VOUCHER_CHECKPOINT_JUMPS === 0) {
      void flushVoucherCheckpoint();
    }

    return true;
  }, [
    currentJumpCost,
    flushVoucherCheckpoint,
    session.channelBalance,
    session.channelConfig,
    session.sessionAddress,
    session.storage,
    session.voucherSigner,
  ]);

  const endGame = useCallback(() => {
    stateRef.current.phase = "game-over";
    setGameOver(true);
    setHudState(prev => ({ ...prev, balance: Number(balanceRef.current) }));
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
    canvasWidth: 800,
    canvasHeight: 400,
  });

  useEffect(() => {
    callbacks.current = {
      onJumpCost: handleJumpCost,
      onGameOver: endGame,
      canvasWidth: canvasRef.current?.width ?? 800,
      canvasHeight: canvasRef.current?.height ?? 400,
    };
  }, [handleJumpCost, endGame]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      canvas.width = rect.width;
      canvas.height = rect.height;
      callbacks.current.canvasWidth = canvas.width;
      callbacks.current.canvasHeight = canvas.height;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const STEP = 16;
    const MAX_ACC = 200;
    const MAX_STEPS = 5;
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
        }
        acc -= STEP;
        steps++;
      }

      if (state.phase !== "game-over") {
        render(ctx, state);

        if (state.frameCount % 10 === 0) {
          setHudState({
            balance: Number(balanceRef.current),
            distance: state.distance,
            voucherCount: jumpCountRef.current,
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

  // Input handling
  useEffect(() => {
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
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
      }
      jumpBufferMsRef.current = JUMP_BUFFER_MS;
      jumpHeldRef.current = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        jumpHeldRef.current = false;
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (jumpHeldRef.current) return;
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
      }
      jumpBufferMsRef.current = JUMP_BUFFER_MS;
      jumpHeldRef.current = true;
    };

    const handleTouchEnd = () => {
      jumpHeldRef.current = false;
    };

    const handlePageHide = () => {
      void flushVoucherCheckpoint(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("pagehide", handlePageHide);
    const canvas = canvasRef.current;
    canvas?.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas?.addEventListener("touchend", handleTouchEnd);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("pagehide", handlePageHide);
      canvas?.removeEventListener("touchstart", handleTouchStart);
      canvas?.removeEventListener("touchend", handleTouchEnd);
    };
  }, [flushVoucherCheckpoint, started, toggleDevFreeze]);

  const handleSubmitScore = async () => {
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
    }
  };

  return (
    <div className="relative w-full h-[400px] rounded-2xl overflow-hidden border border-[var(--color-surface-lighter)]">
      <GameHUD
        balance={hudState.balance}
        distance={hudState.distance}
        voucherCount={hudState.voucherCount}
      />

      <canvas ref={canvasRef} className="w-full h-full block" />

      {!started && !gameOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] z-10">
          <div className="text-center animate-slide-up">
            <p className="text-lg font-bold text-white mb-2">Press SPACE or tap to start</p>
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
          totalSpent={Number(roundSpentRef.current)}
          rank={rank}
          onPlayAgain={onPlayAgain}
          onSubmitScore={handleSubmitScore}
        />
      )}
    </div>
  );
}
