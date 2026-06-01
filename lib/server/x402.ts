import { facilitator } from "@coinbase/x402";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  FACILITATOR_URL,
  NETWORK,
  RECEIVER_ADDRESS,
  USDC_ADDRESS,
  WITHDRAW_DELAY,
} from "../x402/config";
import { channelStorage } from "./storage";

if (!RECEIVER_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(RECEIVER_ADDRESS)) {
  console.warn("[batch-runner] EVM_ADDRESS / NEXT_PUBLIC_RECEIVER_ADDRESS not set or invalid");
}

const receiverAuthorizerPrivateKey = process.env.EVM_RECEIVER_AUTHORIZER_PRIVATE_KEY as
  | `0x${string}`
  | undefined;
const receiverAuthorizerSigner = receiverAuthorizerPrivateKey
  ? privateKeyToAccount(receiverAuthorizerPrivateKey)
  : undefined;

const facilitatorClient = FACILITATOR_URL
  ? new HTTPFacilitatorClient({ url: FACILITATOR_URL })
  : new HTTPFacilitatorClient(facilitator);

const batchedScheme = new BatchSettlementEvmScheme(RECEIVER_ADDRESS, {
  ...(receiverAuthorizerSigner ? { receiverAuthorizerSigner } : {}),
  withdrawDelay: WITHDRAW_DELAY,
  storage: channelStorage,
});

const defaultEnrichSettlementResponse = batchedScheme.enrichSettlementResponse.bind(batchedScheme);
batchedScheme.enrichSettlementResponse = async ctx => {
  const extra = await defaultEnrichSettlementResponse(ctx);
  const settleExtra = ctx.result?.extra;
  const settledState =
    settleExtra &&
    typeof settleExtra === "object" &&
    settleExtra.channelState &&
    typeof settleExtra.channelState === "object"
      ? (settleExtra.channelState as Record<string, unknown>)
      : undefined;

  if (!extra?.channelState && !settledState) return extra;

  return {
    ...extra,
    channelState: {
      ...extra?.channelState,
      ...(settledState?.channelId !== undefined
        ? { channelId: String(settledState.channelId) }
        : {}),
      ...(settledState?.balance !== undefined ? { balance: String(settledState.balance) } : {}),
      ...(settledState?.totalClaimed !== undefined
        ? { totalClaimed: String(settledState.totalClaimed) }
        : {}),
      ...(settledState?.withdrawRequestedAt !== undefined
        ? { withdrawRequestedAt: Number(settledState.withdrawRequestedAt) }
        : {}),
      ...(settledState?.refundNonce !== undefined
        ? { refundNonce: String(settledState.refundNonce) }
        : {}),
      ...(settledState?.chargedCumulativeAmount !== undefined
        ? { chargedCumulativeAmount: String(settledState.chargedCumulativeAmount) }
        : {}),
    },
  };
};

export const server = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, batchedScheme)
  .registerExtension(bazaarResourceServerExtension);
export const channelManager = batchedScheme.createChannelManager(facilitatorClient, NETWORK);
export const storage = channelStorage;
export const receiverAddress = RECEIVER_ADDRESS;
export const tokenAddress = USDC_ADDRESS;
