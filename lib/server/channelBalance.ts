import { BATCH_SETTLEMENT_ADDRESS } from "@x402/evm";
import { createPublicClient, http } from "viem";

import { CHAIN } from "../x402/config";

const channelsAbi = [
  {
    type: "function",
    name: "channels",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "balance", type: "uint128" },
      { name: "totalClaimed", type: "uint128" },
    ],
    stateMutability: "view",
  },
] as const;

export function createChainPublicClient() {
  const rpcUrl = process.env.RPC_URL?.trim();
  return createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl || undefined),
  });
}

export async function readOnChainChannelBalance(channelId: `0x${string}`): Promise<bigint> {
  const client = createChainPublicClient();
  const readContract = client.readContract as (args: Record<string, unknown>) => Promise<unknown>;
  const [balance] = (await readContract({
    address: BATCH_SETTLEMENT_ADDRESS,
    abi: channelsAbi,
    functionName: "channels",
    args: [channelId],
  })) as [bigint, bigint];
  return balance;
}
