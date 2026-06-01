"use client";

import { useEffect, useState } from "react";
import { WalletConnect, type BaseAuthSession } from "@/components/WalletConnect";
import { DepositFlow, type SessionInfo } from "@/components/DepositFlow";
import { Game } from "@/components/Game";
import { buildGameChannelConfig } from "@/lib/x402/channel";
import { NEXT_DEV, RECEIVER_ADDRESS, roundBudgetUnits } from "@/lib/x402/config";
import { prepareNextRunSession } from "@/lib/x402/runSession";
import { LocalStorageChannelStorage } from "@/lib/x402/browserStorage";
import {
  createStoredSessionKey,
  loadStoredSessionKey,
  signerFromStoredSession,
} from "@/lib/x402/sessionKey";

const DEV_PLAYER_ADDRESS = "0x000000000000000000000000000000000000dead" as const;
const DEV_DELEGATION_SIGNATURE = "0x11" as const;

export default function Home() {
  const [authSession, setAuthSession] = useState<BaseAuthSession | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [autoStart, setAutoStart] = useState(false);

  useEffect(() => {
    if (!NEXT_DEV) return;

    setSession(createDevSession());
  }, []);

  const handlePlayAgain = async () => {
    if (!session) return;

    const next = await prepareNextRunSession(session);
    if (!next) {
      setAutoStart(false);
      setSession(null);
      setGameKey(k => k + 1);
      return;
    }

    setAutoStart(true);
    setSession(next);
    setGameKey(k => k + 1);
  };

  const handleSessionReady = (nextSession: SessionInfo) => {
    setAutoStart(false);
    setSession(nextSession);
  };

  const handleSignOut = () => {
    setAuthSession(null);
    setSession(null);
  };

  const showWallet = !NEXT_DEV;
  const isPlaying = !!session;

  if (isPlaying) {
    return (
      <main className="fixed inset-0 w-full h-dvh overflow-hidden">
        {!showWallet && (
          <div className="absolute top-3 right-3 z-20">
            <span className="px-3 py-1.5 text-xs border border-[var(--color-base-blue)] rounded-lg text-[var(--color-base-blue)]">
              NEXT_DEV
            </span>
          </div>
        )}
        <Game key={gameKey} session={session} onPlayAgain={handlePlayAgain} autoStart={autoStart} />
      </main>
    );
  }

  const isLoginPage = !NEXT_DEV && !authSession;
  const isDepositPage = !NEXT_DEV && !!authSession;

  return (
    <main
      className={`min-h-dvh flex flex-col items-center px-4 ${
        isDepositPage ? "relative overflow-hidden" : "justify-center py-8"
      } ${isLoginPage ? "bg-black" : ""}`}
    >
      {isDepositPage && (
        <>
          <div
            className="absolute inset-0 bg-[var(--color-base-blue-dark)] bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url(/bkg.png)" }}
            aria-hidden
          />
          <div className="absolute inset-0 bg-[var(--color-base-blue-dark)]/60" aria-hidden />
          <div className="absolute top-3 right-3 z-20">
            <WalletConnect session={authSession} onSignIn={setAuthSession} onSignOut={handleSignOut} />
          </div>
        </>
      )}
      <div
        className={`w-full ${isDepositPage ? "max-w-4xl relative z-10 min-h-dvh" : isLoginPage ? "max-w-4xl" : "max-w-2xl"}`}
      >
        {NEXT_DEV ? (
          <DevLoading />
        ) : !authSession ? (
          <Landing onSignIn={setAuthSession} onSignOut={handleSignOut} />
        ) : (
          <DepositFlow authSession={authSession} onSessionReady={handleSessionReady} />
        )}
      </div>
    </main>
  );
}

function createDevSession(): SessionInfo {
  const stored =
    loadStoredSessionKey(DEV_PLAYER_ADDRESS) ??
    createStoredSessionKey(DEV_PLAYER_ADDRESS, DEV_DELEGATION_SIGNATURE);
  const { voucherSigner } = signerFromStoredSession(stored);
  const { config, channelId } = buildGameChannelConfig(
    stored.playerAddress,
    stored.sessionAddress,
    RECEIVER_ADDRESS,
    RECEIVER_ADDRESS,
    stored.channelSalt,
  );

  return {
    channelSalt: stored.channelSalt,
    sessionAddress: stored.sessionAddress,
    voucherSigner,
    playerAddress: stored.playerAddress,
    channelId,
    channelConfig: config,
    channelBalance: roundBudgetUnits(),
    chargedCumulativeAmount: 0n,
    roundBudget: roundBudgetUnits(),
    storage: new LocalStorageChannelStorage(),
  };
}

function DevLoading() {
  return (
    <div className="animate-slide-up flex flex-col items-center gap-3 py-16 text-sm text-[var(--color-text-secondary)]">
      Starting local gameplay session...
    </div>
  );
}

function Landing({
  onSignIn,
  onSignOut,
}: {
  onSignIn: (session: BaseAuthSession) => void;
  onSignOut: () => void;
}) {
  return (
    <div className="landing-screen">
      <img src="/logo.png" alt="Batch Runner" className="landing-logo" width={1536} height={1024} />
      <WalletConnect session={null} onSignIn={onSignIn} onSignOut={onSignOut} />
    </div>
  );
}
