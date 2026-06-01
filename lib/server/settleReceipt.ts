import { BATCH_SETTLEMENT_ADDRESS } from "@x402/evm";
import {
  createPublicClient,
  getAddress,
  http,
  isAddressEqual,
  parseEventLogs,
  type Hash,
} from "viem";
import { CHAIN, RECEIVER_ADDRESS, USDC_ADDRESS } from "../x402/config";

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

export async function getSettledAmountFromReceipt(transactionHash: Hash): Promise<bigint> {

  const client = createPublicClient({
    chain: CHAIN,
    transport: http(),
  });

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
