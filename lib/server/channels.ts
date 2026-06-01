import type { Channel } from "@x402/evm/batch-settlement/server";
import { storage } from "./x402";

export async function listPlayerChannels(payer: `0x${string}`): Promise<Channel[]> {
  const channels = await storage.list();
  const mine = channels.filter(
    channel => channel.channelConfig.payer.toLowerCase() === payer.toLowerCase(),
  );

  const prepared: Channel[] = [];
  for (const channel of mine) {
    const result = await storage.updateChannel(channel.channelId, current => {
      if (!current?.pendingRequest) return current;
      if (current.pendingRequest.expiresAt > Date.now()) return current;
      return { ...current, pendingRequest: undefined };
    });
    prepared.push(result.channel ?? channel);
  }

  return prepared;
}

export function channelToClientRecord(channel: Channel) {
  return {
    channelId: channel.channelId,
    channelConfig: channel.channelConfig,
    balance: channel.balance,
    chargedCumulativeAmount: channel.chargedCumulativeAmount,
    totalClaimed: channel.totalClaimed,
    signedMaxClaimable: channel.signedMaxClaimable,
    signature: channel.signature,
  };
}
