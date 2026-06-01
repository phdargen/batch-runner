import { createPublicClient, getAddress, http, zeroAddress, type Address } from "viem";
import { base } from "viem/chains";

const BASE_MAINNET_RPC_FALLBACK = "https://mainnet.base.org";
const REVERSE_REGISTRAR = "0x79ea96012eea67a83431f1701b3dff7e37f9e282" as const;
const REGISTRY = "0xb94704422c2a1e396835a571837aa5ae53285a95" as const;

const reverseRegistrarAbi = [
  {
    type: "function",
    name: "node",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const registryAbi = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const resolverAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "string" }],
  },
] as const;

const readContract = (client: { readContract: (args: never) => Promise<unknown> }, args: Record<string, unknown>) =>
  client.readContract(args as never);

async function readBasenameFromRpc(rpcUrl: string, address: Address): Promise<string | null> {
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const node = (await readContract(client, {
    address: REVERSE_REGISTRAR,
    abi: reverseRegistrarAbi,
    functionName: "node",
    args: [address],
  })) as `0x${string}`;

  const resolver = (await readContract(client, {
    address: REGISTRY,
    abi: registryAbi,
    functionName: "resolver",
    args: [node],
  })) as Address;

  if (!resolver || resolver === zeroAddress) return null;

  const name = (await readContract(client, {
    address: resolver,
    abi: resolverAbi,
    functionName: "name",
    args: [node],
  })) as string;

  return name || null;
}

export async function resolveBasename(address: Address): Promise<string | null> {
  const configuredRpc = process.env.RPC_URL?.trim();
  if (!configuredRpc) return null;

  const normalized = getAddress(address);

  try {
    const name = await readBasenameFromRpc(configuredRpc, normalized);
    if (name) return name;
  } catch {
    // Custom RPC may be misconfigured (e.g. Ethereum mainnet URL).
  }

  if (configuredRpc === BASE_MAINNET_RPC_FALLBACK) return null;

  try {
    return await readBasenameFromRpc(BASE_MAINNET_RPC_FALLBACK, normalized);
  } catch {
    return null;
  }
}
