import type { Channel } from "@x402/evm/batch-settlement/server";
import { getAddress } from "viem";
import { storage } from "./x402";

/** App metadata persisted alongside x402 channel records in server storage. */
export type GameChannel = Channel & { isActive?: boolean };

export async function listPlayerChannels(payer: `0x${string}`): Promise<GameChannel[]> {
  const channels = await storage.list();
  const mine = channels.filter(
    channel => channel.channelConfig.payer.toLowerCase() === payer.toLowerCase(),
  );

  const prepared: GameChannel[] = [];
  for (const channel of mine) {
    const result = await storage.updateChannel(channel.channelId, current => {
      if (!current?.pendingRequest) return current;
      if (current.pendingRequest.expiresAt > Date.now()) return current;
      return { ...current, pendingRequest: undefined };
    });
    prepared.push((result.channel ?? channel) as GameChannel);
  }

  return prepared;
}

export function channelToClientRecord(channel: Channel) {
  const gameChannel = channel as GameChannel;
  return {
    channelId: channel.channelId,
    channelConfig: channel.channelConfig,
    balance: channel.balance,
    chargedCumulativeAmount: channel.chargedCumulativeAmount,
    totalClaimed: channel.totalClaimed,
    signedMaxClaimable: channel.signedMaxClaimable,
    signature: channel.signature,
    isActive: gameChannel.isActive ?? false,
  };
}

function setChannelActiveFlag(channelId: string, isActive: boolean): Promise<void> {
  return storage
    .updateChannel(channelId, current => {
      if (!current) return current;
      const gameChannel = current as GameChannel;
      if (!!gameChannel.isActive === isActive) return current;
      return { ...current, isActive };
    })
    .then(() => undefined);
}

/** Marks one channel active and deactivates all other channels for the same payer. */
export async function activatePlayerChannel(
  payer: `0x${string}`,
  channelId: `0x${string}`,
): Promise<void> {
  const channels = await listPlayerChannels(payer);
  const targetId = channelId.toLowerCase();

  await Promise.all(
    channels.map(channel =>
      setChannelActiveFlag(channel.channelId, channel.channelId.toLowerCase() === targetId),
    ),
  );

  if (!channels.some(channel => channel.channelId.toLowerCase() === targetId)) {
    await setChannelActiveFlag(channelId, true);
  }
}

/** Deactivates active channels whose session key no longer matches the current login. */
export async function deactivateStalePlayerChannels(
  payer: `0x${string}`,
  sessionAddress: `0x${string}`,
): Promise<void> {
  const channels = await listPlayerChannels(payer);
  const currentSession = sessionAddress.toLowerCase();

  await Promise.all(
    channels
      .filter(channel => {
        if (!channel.isActive) return false;
        return (
          getAddress(channel.channelConfig.payerAuthorizer).toLowerCase() !== currentSession
        );
      })
      .map(channel => setChannelActiveFlag(channel.channelId, false)),
  );
}

export async function deactivatePlayerChannel(channelId: `0x${string}`): Promise<void> {
  await setChannelActiveFlag(channelId, false);
}
