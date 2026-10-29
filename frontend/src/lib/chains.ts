export interface ChainInfo {
  id: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  explorerUrl: string;
  testnet: boolean;
}

export const CHAINS: Record<number, ChainInfo> = {
  91562037: {
    id: 91562037,
    name: "MST Testnet",
    symbol: "tMSTC",
    rpcUrl: "https://testnetrpc.mstblockchain.com",
    explorerUrl: "https://testnet.mstscan.com",
    testnet: true,
  },
  4646: {
    id: 4646,
    name: "MST Mainnet",
    symbol: "MSTC",
    rpcUrl: "https://mariorpc.mstblockchain.com/",
    explorerUrl: "https://mstscan.com",
    testnet: false,
  },
};

export const hexChainId = (id: number): string => "0x" + id.toString(16);
