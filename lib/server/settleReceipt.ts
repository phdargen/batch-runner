import { BATCH_SETTLEMENT_ADDRESS } from "@x402/evm";
import { getAddress, isAddressEqual, parseEventLogs, type Hash } from "viem";

import { createChainPublicClient } from "./channelBalance";
import { RECEIVER_ADDRESS, USDC_ADDRESS } from "../x402/config";

const settledEventAbi = [
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount", type: "uint128", indexed: false },
    ],
  },
] as const;

const transferEventAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export async function getSettledAmountFromReceipt(transactionHash: Hash): Promise<bigint> {
  const client = createChainPublicClient();

  const receipt = await client.getTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") return 0n;

  const contractAddress = getAddress(BATCH_SETTLEMENT_ADDRESS);
  const receiver = getAddress(RECEIVER_ADDRESS);
  const token = getAddress(USDC_ADDRESS);

  const logs = parseEventLogs({
    abi: settledEventAbi,
    eventName: "Settled",
    logs: receipt.logs.filter(log => isAddressEqual(log.address, contractAddress)),
  });

  let total = 0n;
  for (const log of logs) {
    if (!isAddressEqual(log.args.receiver, receiver) || !isAddressEqual(log.args.token, token)) {
      continue;
    }
    total += log.args.amount;
  }

  return total;
}

/** USDC sent to the payer in a cooperative refund transaction. */
export async function getRefundedAmountFromReceipt(
  transactionHash: Hash,
  payer: `0x${string}`,
): Promise<bigint> {
  const client = createChainPublicClient();
  const receipt = await client.getTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") return 0n;

  const token = getAddress(USDC_ADDRESS);
  const recipient = getAddress(payer);

  const logs = parseEventLogs({
    abi: transferEventAbi,
    eventName: "Transfer",
    logs: receipt.logs.filter(log => isAddressEqual(log.address, token)),
  });

  let total = 0n;
  for (const log of logs) {
    if (!isAddressEqual(log.args.to, recipient)) continue;
    total += log.args.value;
  }

  return total;
}
