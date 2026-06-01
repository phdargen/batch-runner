"use client";

import { useEffect, useMemo, useState } from "react";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import type { Account, WalletClient } from "viem";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import type { ChannelConfig } from "@x402/evm";
import { BATCH_SETTLEMENT_ADDRESS } from "@x402/evm";
import {
  BatchSettlementEvmScheme,
  computeChannelId,
  processPaymentResponse,
  updateChannelAfterRefund,
} from "@x402/evm/batch-settlement/client";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import {
  JUMP_COST_UNITS,
  NETWORK,
  NEXT_DEV,
  PLAY_PRICE_UNITS,
  roundBudgetUnits,
  RECEIVER_ADDRESS,
} from "@/lib/x402/config";
import { buildGameChannelConfig } from "@/lib/x402/channel";
import {
  createStoredSessionKey,
  loadStoredSessionKey,
  signerFromStoredSession,
  type StoredSessionKey,
} from "@/lib/x402/sessionKey";
import {
  availableChannelBalance,
  LocalStorageChannelStorage,
  TopUpChannelStorage,
  type BatchSettlementClientContext,
} from "@/lib/x402/browserStorage";
import type { ClientEvmSigner } from "@x402/evm";
import type { BaseAuthSession } from "./WalletConnect";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

const channelsAbi = [
  {
    type: "function",
    name: "channels",
    stateMutability: "view",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "totalClaimed", type: "uint256" },
    ],
  },
] as const;

const JUMP_PRESETS = [10, 20, 50, 100] as const;
const DEFAULT_JUMPS = 20;
const MAX_CUSTOM_JUMPS = 1000;

const RULE_HINTS = [
  { key: "pay-per-jump", label: "Pay per jump", icon: PayPerJumpIcon },
  { key: "per-run", label: "Max 10 / run", icon: PerRunIcon },
  { key: "carryover", label: "Unused carry over", icon: CarryOverIcon },
] as const;

const readContract = publicClient.readContract as (
  args: Record<string, unknown>,
) => Promise<unknown>;

function readChannelId(settleExtra: Record<string, unknown> | undefined): `0x${string}` | null {
  const channelState = settleExtra?.channelState;
  if (typeof channelState !== "object" || channelState === null) return null;

  const channelId = (channelState as { channelId?: unknown }).channelId;
  return typeof channelId === "string" && channelId.startsWith("0x")
    ? (channelId as `0x${string}`)
    : null;
}

function wagmiToClientSigner(walletClient: WalletClient): ClientEvmSigner {
  if (!walletClient.account) {
    throw new Error("Wallet client must have an account");
  }

  return {
    address: walletClient.account.address,
    signTypedData: message =>
      walletClient.signTypedData({
        account: walletClient.account as Account | `0x${string}`,
        domain: message.domain,
        types: message.types,
        primaryType: message.primaryType,
        message: message.message,
      }),
    readContract: args => readContract(args as unknown as Record<string, unknown>),
  };
}

export type SessionInfo = {
  channelSalt: `0x${string}`;
  sessionAddress: `0x${string}`;
  voucherSigner: ClientEvmSigner;
  playerAddress: `0x${string}`;
  channelId: `0x${string}` | null;
  channelConfig: ChannelConfig | null;
  channelBalance: bigint;
  chargedCumulativeAmount: bigint;
  roundBudget: bigint;
  storage: LocalStorageChannelStorage;
};

type DepositFlowProps = {
  authSession: BaseAuthSession;
  onSessionReady: (session: SessionInfo) => void;
};

type ChannelSnapshot = {
  channelId: `0x${string}` | null;
  channelConfig: ChannelConfig | null;
  balance: bigint;
  chargedCumulativeAmount: bigint;
  availableBalance: bigint;
};

export function DepositFlow({ authSession, onSessionReady }: DepositFlowProps) {
  const [storedSession, setStoredSession] = useState<StoredSessionKey | null>(null);
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null);
  const [presetJumps, setPresetJumps] = useState<number>(DEFAULT_JUMPS);
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [status, setStatus] = useState<"loading" | "idle" | "depositing" | "refunding">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refundConfirmOpen, setRefundConfirmOpen] = useState(false);

  const storage = useMemo(() => new LocalStorageChannelStorage(), []);
  const topUpStorage = useMemo(() => new TopUpChannelStorage(), []);

  const customJumps = parseCustomJumps(customInput);
  const selectedJumps = customMode ? customJumps : presetJumps;
  const selectedDeposit = BigInt(selectedJumps) * JUMP_COST_UNITS;
  const hasChannel = Boolean(snapshot?.channelId && snapshot.channelConfig);
  const canStart = hasChannel && (NEXT_DEV || (snapshot?.availableBalance ?? 0n) >= JUMP_COST_UNITS);
  const { voucherSigner } = storedSession
    ? signerFromStoredSession(storedSession)
    : { voucherSigner: null };

  useEffect(() => {
    const existing = loadStoredSessionKey(authSession.address);
    const next = existing ?? createStoredSessionKey(authSession.address, authSession.signature);
    setStoredSession(next);
  }, [authSession.address, authSession.signature]);

  useEffect(() => {
    if (!storedSession) return;

    refreshChannel(storedSession)
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load channel"))
      .finally(() => setStatus("idle"));
  }, [storedSession]);

  const startSession = () => {
    if (!storedSession || !voucherSigner) return;

    const available = snapshot?.availableBalance ?? 0n;
    const perRunBudget = NEXT_DEV ? roundBudgetUnits() : minBigInt(available, roundBudgetUnits());

    onSessionReady({
      channelSalt: storedSession.channelSalt,
      sessionAddress: storedSession.sessionAddress,
      voucherSigner,
      playerAddress: authSession.address,
      channelId: snapshot?.channelId ?? null,
      channelConfig: snapshot?.channelConfig ?? null,
      channelBalance: snapshot?.balance ?? PLAY_PRICE_UNITS,
      chargedCumulativeAmount: snapshot?.chargedCumulativeAmount ?? 0n,
      roundBudget: perRunBudget,
      storage,
    });
  };

  const fundChannel = async () => {
    if (!storedSession || !voucherSigner) return;

    setStatus("depositing");
    setError(null);

    try {
      const currentAvailable = snapshot?.availableBalance ?? 0n;
      const fundingStorage = currentAvailable > 0n ? topUpStorage : storage;
      const batchedScheme = createBatchedScheme(storedSession, fundingStorage, selectedDeposit);
      const client = new x402Client();
      client.register(NETWORK, batchedScheme);

      const fetchWithPayment = wrapFetchWithPayment(fetch, client);

      const response = await fetchWithPayment(`${window.location.origin}/api/game/start`, {
        method: "GET",
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Deposit failed (${response.status}): ${text}`);
      }

      await processPaymentResponse(fundingStorage, name => response.headers.get(name));
      await refreshChannel(storedSession, readSettledChannelId(response));
    } catch (err) {
      console.error("[batch-runner] Deposit error:", err);
      setError(err instanceof Error ? err.message : "Failed to deposit");
    } finally {
      setStatus("idle");
    }
  };

  const requestRefund = async () => {
    if (!storedSession) return;

    setRefundConfirmOpen(false);
    setStatus("refunding");
    setError(null);

    try {
      const channelId = snapshot?.channelId;
      if (!channelId) {
        throw new Error("No funded channel to refund");
      }

      const batchedScheme = createBatchedScheme(storedSession, storage, selectedDeposit);
      const settleResponse = await batchedScheme.refund(`${window.location.origin}/api/game/start`);
      await updateChannelAfterRefund(storage, channelId.toLowerCase(), settleResponse.extra ?? {});
      await refreshChannel(storedSession, channelId);
    } catch (err) {
      console.error("[batch-runner] Refund error:", err);
      setError(err instanceof Error ? err.message : "Failed to request refund");
    } finally {
      setStatus("idle");
    }
  };

  async function refreshChannel(
    session: StoredSessionKey,
    knownChannelId?: `0x${string}` | null,
  ): Promise<void> {
    if (NEXT_DEV) {
      const debugChannel = getDebugChannel(session);
      const devBudget = roundBudgetUnits();
      setSnapshot({
        channelId: debugChannel?.channelId ?? null,
        channelConfig: debugChannel?.config ?? null,
        balance: devBudget,
        chargedCumulativeAmount: 0n,
        availableBalance: devBudget,
      });
      return;
    }

    const derivedChannel = await getChannelInfo(session);
    const channel = {
      channelId: knownChannelId ?? derivedChannel.channelId,
      channelConfig: derivedChannel.channelConfig,
    };
    if (!channel.channelId) {
      setSnapshot({
        channelId: null,
        channelConfig: null,
        balance: 0n,
        chargedCumulativeAmount: 0n,
        availableBalance: 0n,
      });
      return;
    }

    let context = await storage.get(channel.channelId);
    context = await recoverChannelContext(channel.channelId, context);

    setSnapshot({
      channelId: channel.channelId,
      channelConfig: channel.channelConfig,
      balance: BigInt(context?.balance ?? "0"),
      chargedCumulativeAmount: BigInt(context?.chargedCumulativeAmount ?? "0"),
      availableBalance: availableChannelBalance(context),
    });
  }

  async function getChannelInfo(
    session: StoredSessionKey,
  ): Promise<{ channelId: `0x${string}` | null; channelConfig: ChannelConfig | null }> {
    const requirements = await getGamePaymentRequirements();
    if (!requirements) return { channelId: null, channelConfig: null };

    const batchedScheme = createBatchedScheme(session, storage, selectedDeposit);
    const channelConfig = batchedScheme.buildChannelConfig(requirements);
    return { channelId: computeChannelId(channelConfig, requirements.network), channelConfig };
  }

  async function recoverChannelContext(
    channelId: `0x${string}`,
    context: BatchSettlementClientContext | undefined,
  ): Promise<BatchSettlementClientContext | undefined> {
    const [balance, totalClaimed] = (await readContract({
      address: BATCH_SETTLEMENT_ADDRESS,
      abi: channelsAbi,
      functionName: "channels",
      args: [channelId],
    })) as [bigint, bigint];

    if (balance === 0n) {
      await storage.delete(channelId);
      return undefined;
    }

    const recoveredCharged =
      BigInt(context?.chargedCumulativeAmount ?? "0") > totalClaimed
        ? context?.chargedCumulativeAmount
        : totalClaimed.toString();
    const next = {
      ...(context ?? {}),
      balance: balance.toString(),
      chargedCumulativeAmount: recoveredCharged,
      totalClaimed: totalClaimed.toString(),
    };
    await storage.set(channelId, next);
    return next;
  }

  function createBatchedScheme(
    session: StoredSessionKey,
    channelStorage: LocalStorageChannelStorage,
    depositAmount: bigint,
  ): BatchSettlementEvmScheme {
    const walletSigner = wagmiToClientSigner(authSession.walletClient);
    const { voucherSigner: sessionVoucherSigner } = signerFromStoredSession(session);

    return new BatchSettlementEvmScheme(walletSigner, {
      voucherSigner: sessionVoucherSigner,
      salt: session.channelSalt,
      storage: channelStorage,
      depositStrategy: () => depositAmount.toString(),
    });
  }

  const availableBalance = snapshot?.availableBalance ?? 0n;
  const balanceJumps = jumpsFromUnits(availableBalance);
  const isBusy = status !== "idle";
  const showRefund = availableBalance > 0n;
  const selectedValid = selectedJumps > 0;
  const selectedPrice = formatUsdc(selectedDeposit);

  return (
    <div className="deposit-flow animate-slide-up">
      <img src="/logo.png" alt="Batch Runner" className="deposit-logo" width={1536} height={1024} />

      <div className="deposit-card">
        <div className="deposit-card-fx" aria-hidden />
        <div className="deposit-card-body">
          <p className="deposit-intro">
            Batch jumps to run through Base City.
            <br />
            <br />
            How far can you get Rex402 with 100 jumps? Make them count.
          </p>

          <div className="deposit-run-row">
            <img
              src="/jetpack.png"
              alt=""
              className="deposit-jetpack"
              width={128}
              height={128}
              aria-hidden
            />
            <div className="deposit-balance">
              {status === "loading" ? (
                <span className="deposit-balance-count tabular-nums" aria-busy="true">
                  …
                </span>
              ) : (
                <span className="deposit-balance-count tabular-nums">{balanceJumps}</span>
              )}
              <span className="deposit-balance-unit">jumps in tank</span>
            </div>
            {showRefund && status !== "loading" && (
              <button
                type="button"
                onClick={() => setRefundConfirmOpen(true)}
                disabled={isBusy}
                aria-label="Refund remaining jumps"
                className="deposit-refund-hint"
              >
                <RefundIcon />
                <span>{status === "refunding" ? "…" : "Refund"}</span>
              </button>
            )}
          </div>

          <ul className="deposit-hints" aria-label="How jumps work">
            {RULE_HINTS.map(({ key, label, icon: Icon }) => (
              <li key={key} className="deposit-hint">
                <Icon />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          <div className="deposit-picker" role="group" aria-label="Jumps to add">
            {JUMP_PRESETS.map(jumps => {
              const active = !customMode && presetJumps === jumps;

              return (
                <button
                  key={jumps}
                  type="button"
                  disabled={isBusy}
                  aria-pressed={active}
                  aria-label={`${jumps} jumps`}
                  onClick={() => {
                    setCustomMode(false);
                    setPresetJumps(jumps);
                  }}
                  className={`deposit-option ${active ? "deposit-option-active" : ""}`}
                >
                  <span className="deposit-option-count tabular-nums">{jumps}</span>
                  <span className="deposit-option-unit">jumps</span>
                </button>
              );
            })}

            <button
              type="button"
              disabled={isBusy}
              aria-pressed={customMode}
              aria-label="Custom amount of jumps"
              onClick={() => setCustomMode(true)}
              className={`deposit-option ${customMode ? "deposit-option-active" : ""}`}
            >
              <span className="deposit-option-count">···</span>
              <span className="deposit-option-unit">custom</span>
            </button>
          </div>

          {customMode && (
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_CUSTOM_JUMPS}
              step={1}
              autoFocus
              disabled={isBusy}
              value={customInput}
              onChange={event => setCustomInput(event.target.value)}
              placeholder={`Jumps (1–${MAX_CUSTOM_JUMPS})`}
              aria-label="Custom jump count"
              className="deposit-custom"
            />
          )}

          <div className="deposit-actions">
            <button
              type="button"
              onClick={fundChannel}
              disabled={NEXT_DEV || status === "loading" || isBusy || !selectedValid}
              className="deposit-btn deposit-btn-secondary"
            >
              {status === "depositing"
                ? "…"
                : selectedValid
                  ? `Add ${selectedJumps} · $${selectedPrice}`
                  : "Add jumps"}
            </button>

            <button
              type="button"
              onClick={startSession}
              disabled={!canStart || isBusy}
              className="deposit-btn deposit-btn-primary"
            >
              Play
            </button>
          </div>

          {error && <p className="deposit-error">{error}</p>}
        </div>
      </div>

      {refundConfirmOpen && (
        <div
          className="deposit-confirm-backdrop"
          role="presentation"
          onClick={() => !isBusy && setRefundConfirmOpen(false)}
        >
          <div
            className="deposit-confirm"
            role="alertdialog"
            aria-labelledby="deposit-refund-title"
            aria-describedby="deposit-refund-desc"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="deposit-refund-title" className="deposit-confirm-title">
              Refund jumps?
            </h2>
            <p id="deposit-refund-desc" className="deposit-confirm-body">
              {balanceJumps} unused {balanceJumps === 1 ? "jump" : "jumps"} (${formatUsdc(availableBalance)})
              will be returned to your wallet.
            </p>
            <div className="deposit-confirm-actions">
              <button
                type="button"
                className="deposit-btn deposit-btn-secondary"
                disabled={isBusy}
                onClick={() => setRefundConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="deposit-btn deposit-btn-primary"
                disabled={isBusy}
                onClick={requestRefund}
              >
                {status === "refunding" ? "Refunding…" : "Confirm refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function getGamePaymentRequirements(): Promise<PaymentRequirements | null> {
  const response = await fetch(`${window.location.origin}/api/game/start`, { method: "GET" });
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (!header) return null;

  const paymentRequired = decodePaymentRequiredHeader(header);
  return paymentRequired.accepts.find(accept => accept.scheme === "batch-settlement") ?? null;
}

function readSettledChannelId(response: Response): `0x${string}` | null {
  const header =
    response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;

  return readChannelId(decodePaymentResponseHeader(header).extra);
}

function getDebugChannel(
  session: StoredSessionKey,
): { config: ChannelConfig; channelId: `0x${string}` } | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(RECEIVER_ADDRESS)) return null;
  return buildGameChannelConfig(
    session.playerAddress,
    session.sessionAddress,
    RECEIVER_ADDRESS,
    RECEIVER_ADDRESS,
    session.channelSalt,
  );
}

function formatUsdc(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(3);
}

function jumpsFromUnits(amount: bigint): number {
  return Math.floor(Number(amount) / Number(JUMP_COST_UNITS));
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function parseCustomJumps(value: string): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_CUSTOM_JUMPS);
}

function CarryOverIcon() {
  return (
    <svg className="deposit-hint-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M4 12a8 8 0 0 1 13.66-5.66M20 5v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.66 5.66M4 19v-4h4" />
    </svg>
  );
}

function PerRunIcon() {
  return (
    <svg className="deposit-hint-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  );
}

function PayPerJumpIcon() {
  return (
    <svg className="deposit-hint-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5 11 15l4.5-5" />
    </svg>
  );
}

function RefundIcon() {
  return (
    <svg className="deposit-hint-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M3 10h10a4 4 0 0 1 0 8H9" />
      <path d="M7 6 3 10l4 4" />
    </svg>
  );
}
