"use client";

import { useEffect, useMemo, useState } from "react";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import type { Account, WalletClient } from "viem";
import { createPublicClient, http } from "viem";
import type { ChannelConfig } from "@x402/evm";
import { BATCH_SETTLEMENT_ADDRESS } from "@x402/evm";
import {
  BatchSettlementEvmScheme,
  computeChannelId,
  processPaymentResponse,
} from "@x402/evm/batch-settlement/client";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import {
  DEFAULT_JUMPS,
  JUMP_COST_UNITS,
  JUMP_PRESETS,
  MAX_CUSTOM_JUMPS,
  MAX_JUMPS_PER_RUN,
  MIN_CUSTOM_JUMPS,
  CHAIN,
  NETWORK,
  NEXT_DEV,
  RUN_PRICE_UNITS,
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
  listStoredChannelContexts,
  LocalStorageChannelStorage,
  TopUpChannelStorage,
  type BatchSettlementClientContext,
} from "@/lib/x402/browserStorage";
import type { ClientEvmSigner } from "@x402/evm";
import type { BaseAuthSession } from "./WalletConnect";
import { X402BatchSettlementFooter } from "./X402BatchSettlementFooter";

const publicClient = createPublicClient({
  chain: CHAIN,
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

const RULE_HINTS = [
  { key: "pay-per-jump", label: "Pay per jump", icon: PayPerJumpIcon },
  { key: "per-run", label: `Max ${MAX_JUMPS_PER_RUN} / run`, icon: PerRunIcon },
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

type RefundableChannel = {
  channelId: `0x${string}`;
  channelConfig: ChannelConfig;
  availableBalance: bigint;
  isActive: boolean;
};

type ServerChannelRecord = {
  channelId: `0x${string}`;
  channelConfig: ChannelConfig;
  balance?: string;
  chargedCumulativeAmount?: string;
  totalClaimed?: string;
  signedMaxClaimable?: string;
  signature?: `0x${string}`;
};

export function DepositFlow({ authSession, onSessionReady }: DepositFlowProps) {
  const [storedSession, setStoredSession] = useState<StoredSessionKey | null>(null);
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null);
  const [refundableChannels, setRefundableChannels] = useState<RefundableChannel[]>([]);
  const [refundingChannelId, setRefundingChannelId] = useState<`0x${string}` | null>(null);
  const [presetJumps, setPresetJumps] = useState<number>(DEFAULT_JUMPS);
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [status, setStatus] = useState<"loading" | "idle" | "depositing" | "refunding">("loading");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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

    refreshAll(storedSession)
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
      channelBalance: snapshot?.balance ?? RUN_PRICE_UNITS,
      chargedCumulativeAmount: snapshot?.chargedCumulativeAmount ?? 0n,
      roundBudget: perRunBudget,
      storage,
    });
  };

  const fundChannel = async () => {
    if (!storedSession || !voucherSigner) return;

    setStatus("depositing");
    setError(null);
    setSuccessMessage(null);

    try {
      const currentAvailable = snapshot?.availableBalance ?? 0n;
      const fundingStorage = currentAvailable > 0n ? topUpStorage : storage;
      await syncActiveChannelStorageFromServer(fundingStorage);
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
      await refreshAll(storedSession, readSettledChannelId(response));
    } catch (err) {
      console.error("[batch-runner] Deposit error:", err);
      setError(err instanceof Error ? err.message : "Failed to deposit");
    } finally {
      setStatus("idle");
    }
  };

  const requestRefund = async (target: RefundableChannel) => {
    if (!storedSession) return;

    setRefundConfirmOpen(false);
    setRefundingChannelId(target.channelId);
    setStatus("refunding");
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${window.location.origin}/api/game/channels/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: target.channelId,
          address: authSession.address,
        }),
      });

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to request refund");
      }

      await storage.delete(target.channelId);
      await refreshAll(storedSession);
      setSuccessMessage(
        `$${formatUsdc(target.availableBalance)} refunded to your wallet.`,
      );
    } catch (err) {
      console.error("[batch-runner] Refund error:", err);
      setError(err instanceof Error ? err.message : "Failed to request refund");
    } finally {
      setRefundingChannelId(null);
      setStatus("idle");
    }
  };

  async function refreshAll(
    session: StoredSessionKey,
    knownChannelId?: `0x${string}` | null,
  ): Promise<void> {
    await Promise.all([
      refreshChannel(session, knownChannelId),
      loadRefundableChannels(session),
    ]);
  }

  async function loadRefundableChannels(session: StoredSessionKey): Promise<void> {
    if (NEXT_DEV) {
      setRefundableChannels([]);
      return;
    }

    const requirements = await getGamePaymentRequirements();
    if (!requirements) {
      setRefundableChannels([]);
      return;
    }

    let serverRecords: ServerChannelRecord[] = [];
    try {
      const response = await fetch(
        `${window.location.origin}/api/game/channels?address=${authSession.address}`,
      );
      if (response.ok) {
        const body = (await response.json()) as { channels?: ServerChannelRecord[] };
        serverRecords = body.channels ?? [];
      }
    } catch {
      // server list is best-effort; local storage still works
    }

    const contextById = new Map<string, BatchSettlementClientContext>();
    const configById = new Map<string, ChannelConfig>();

    for (const record of serverRecords) {
      const key = record.channelId.toLowerCase();
      configById.set(key, record.channelConfig);
      contextById.set(key, {
        balance: record.balance,
        chargedCumulativeAmount: record.chargedCumulativeAmount,
        totalClaimed: record.totalClaimed,
      });
    }

    for (const { channelId, context } of listStoredChannelContexts()) {
      const key = channelId.toLowerCase();
      contextById.set(key, { ...contextById.get(key), ...context });
    }

    const activeScheme = createBatchedScheme(session, storage, selectedDeposit);
    const activeConfig = activeScheme.buildChannelConfig(requirements);
    const activeChannelId = computeChannelId(activeConfig, requirements.network).toLowerCase();
    configById.set(activeChannelId, activeConfig);

    const channels: RefundableChannel[] = [];

    for (const [channelIdKey, context] of contextById) {
      const channelId = channelIdKey as `0x${string}`;
      const channelConfig = configById.get(channelIdKey);
      if (!channelConfig) continue;

      const recovered = await recoverChannelContext(channelId, context);
      if (!recovered) continue;

      const availableBalance = availableChannelBalance(recovered);
      if (availableBalance <= 0n) continue;

      const isActive =
        channelConfig.payerAuthorizer.toLowerCase() === session.sessionAddress.toLowerCase();

      channels.push({
        channelId,
        channelConfig,
        availableBalance,
        isActive,
      });
    }

    channels.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return Number(b.availableBalance - a.availableBalance);
    });

    setRefundableChannels(channels);
  }

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
    const activeChannelId = derivedChannel.channelId;
    const useKnownChannelId =
      knownChannelId &&
      activeChannelId &&
      knownChannelId.toLowerCase() === activeChannelId.toLowerCase();
    const channel = {
      channelId: useKnownChannelId ? knownChannelId : activeChannelId,
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

  async function syncActiveChannelStorageFromServer(
    channelStorage: LocalStorageChannelStorage,
  ): Promise<void> {
    if (!storedSession) return;

    const requirements = await getGamePaymentRequirements();
    if (!requirements) return;

    const channelId = computeChannelId(
      createBatchedScheme(storedSession, channelStorage, selectedDeposit).buildChannelConfig(
        requirements,
      ),
      requirements.network,
    );

    const response = await fetch(
      `${window.location.origin}/api/game/channels?address=${authSession.address}`,
    );
    if (!response.ok) return;

    const body = (await response.json()) as { channels?: ServerChannelRecord[] };
    const record = body.channels?.find(
      channel => channel.channelId.toLowerCase() === channelId.toLowerCase(),
    );

    if (!record) {
      await channelStorage.delete(channelId);
      return;
    }

    await channelStorage.set(channelId.toLowerCase(), {
      balance: record.balance,
      chargedCumulativeAmount: record.chargedCumulativeAmount,
      totalClaimed: record.totalClaimed,
      signedMaxClaimable: record.signedMaxClaimable,
      signature: record.signature,
    });
  }

  const availableBalance = snapshot?.availableBalance ?? 0n;
  const balanceJumps = jumpsFromUnits(availableBalance);
  const isBusy = status !== "idle";
  const showRefund = refundableChannels.length > 0;
  const inactiveChannels = refundableChannels.filter(channel => !channel.isActive);
  const hasMultipleRefundable = refundableChannels.length > 1;
  const selectedValid = selectedJumps > 0;
  const selectedPrice = formatUsdc(selectedDeposit);

  return (
    <div className="deposit-flow animate-slide-up">
      <div className="deposit-brand">
        <img src="/logo.png" alt="Batch Runner" className="deposit-logo" width={1536} height={1024} />
        <X402BatchSettlementFooter />
      </div>

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
              min={MIN_CUSTOM_JUMPS}
              max={MAX_CUSTOM_JUMPS}
              step={1}
              autoFocus
              disabled={isBusy}
              value={customInput}
              onChange={event => setCustomInput(event.target.value)}
              placeholder={`Jumps (${MIN_CUSTOM_JUMPS}–${MAX_CUSTOM_JUMPS})`}
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
          </div>

          {successMessage && <p className="deposit-success">{successMessage}</p>}
          {error && <p className="deposit-error">{error}</p>}
        </div>
      </div>

      <div className="deposit-play-wrap">
        <button
          type="button"
          onClick={startSession}
          disabled={!canStart || isBusy}
          className="deposit-btn deposit-play-btn"
        >
          Play
        </button>
      </div>

      {refundConfirmOpen && (
        <div
          className="deposit-confirm-backdrop"
          role="presentation"
          onClick={() => !isBusy && setRefundConfirmOpen(false)}
        >
          <div
            className="deposit-confirm deposit-confirm-refund"
            role="alertdialog"
            aria-labelledby="deposit-refund-title"
            aria-describedby="deposit-refund-desc"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="deposit-refund-title" className="deposit-confirm-title">
              Refund jumps?
            </h2>
            <p id="deposit-refund-desc" className="deposit-confirm-body">
              {hasMultipleRefundable || inactiveChannels.length > 0
                ? "Select a channel to refund unused jumps back to your wallet."
                : `${balanceJumps} unused ${balanceJumps === 1 ? "jump" : "jumps"} ($${formatUsdc(refundableChannels[0]?.availableBalance ?? availableBalance)}) will be returned to your wallet.`}
            </p>

            <ul className="deposit-refund-list" aria-label="Refundable channels">
              {refundableChannels.map(channel => {
                const jumps = jumpsFromUnits(channel.availableBalance);
                const isRefunding = refundingChannelId === channel.channelId;

                return (
                  <li
                    key={channel.channelId}
                    className={`deposit-refund-item ${channel.isActive ? "deposit-refund-item-active" : "deposit-refund-item-inactive"}`}
                  >
                    <div className="deposit-refund-item-info">
                      <p className="deposit-refund-item-amount">
                        <span className="deposit-refund-item-balance tabular-nums">
                          {jumps} {jumps === 1 ? "jump" : "jumps"}
                        </span>
                        <span className="deposit-refund-item-sep" aria-hidden>
                          ·
                        </span>
                        <span className="deposit-refund-item-price tabular-nums">
                          ${formatUsdc(channel.availableBalance)}
                        </span>
                      </p>
                      {!channel.isActive && (
                        <p className="deposit-refund-item-status">
                          Inactive · session key not found
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="deposit-btn deposit-btn-primary deposit-refund-item-btn"
                      disabled={isBusy}
                      onClick={() => requestRefund(channel)}
                    >
                      {isRefunding ? "Refunding…" : "Refund"}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="deposit-confirm-actions">
              <button
                type="button"
                className="deposit-btn deposit-btn-secondary"
                disabled={isBusy}
                onClick={() => setRefundConfirmOpen(false)}
              >
                Cancel
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
  if (!Number.isFinite(parsed) || parsed < MIN_CUSTOM_JUMPS) return 0;
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
