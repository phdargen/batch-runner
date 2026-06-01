import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/server";
import {
  FACILITATOR_URL,
  NETWORK,
  RECEIVER_ADDRESS,
  USDC_ADDRESS,
  WITHDRAW_DELAY,
} from "../x402/config";
import { channelStorage } from "./storage";

if (!FACILITATOR_URL) {
  console.warn("[batch-runner] FACILITATOR_URL not set — deposit route will fail at runtime");
}

if (!RECEIVER_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(RECEIVER_ADDRESS)) {
  console.warn("[batch-runner] EVM_ADDRESS / NEXT_PUBLIC_RECEIVER_ADDRESS not set or invalid");
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const batchedScheme = new BatchSettlementEvmScheme(RECEIVER_ADDRESS, {
  withdrawDelay: WITHDRAW_DELAY,
  storage: channelStorage,
});

const defaultEnrichSettlementResponse = batchedScheme.enrichSettlementResponse.bind(batchedScheme);
batchedScheme.enrichSettlementResponse = async ctx => {
  const extra = await defaultEnrichSettlementResponse(ctx);
  if (!extra?.channelState) return extra;

  const channel = batchedScheme.takeChannelSnapshot(ctx.paymentPayload);
  if (!channel) return extra;

  return {
    ...extra,
    channelState: {
      ...extra.channelState,
      channelId: channel.channelId,
      balance: channel.balance,
      totalClaimed: channel.totalClaimed,
      withdrawRequestedAt: channel.withdrawRequestedAt,
      refundNonce: String(channel.refundNonce),
    },
  };
};

export const server = new x402ResourceServer(facilitatorClient).register(NETWORK, batchedScheme);
export const channelManager = batchedScheme.createChannelManager(facilitatorClient, NETWORK);
export const storage = channelStorage;
export const receiverAddress = RECEIVER_ADDRESS;
export const tokenAddress = USDC_ADDRESS;
