import { ChainInfo } from "../chain-info";
import { TxBuilderConfigPrimitive } from "../tx";
import { BroadcastMode, StdTx } from "@cosmjs/launchpad";
import { SecretUtils } from "secretjs/types/enigmautils";

// TODO: Return the `Uint8Array` instead of hex string.
export interface KeyHex {
  // Name of the selected key store.
  readonly name: string;
  readonly algo: string;
  readonly pubKeyHex: string;
  readonly addressHex: string;
  readonly bech32Address: string;
}

export interface Keplr {
  experimentalSuggestChain(chainInfo: ChainInfo): Promise<void>;
  enable(chainId: string): Promise<void>;
  getKey(chainId: string): Promise<KeyHex>;
  // TODO: Return the cosmjs's config?
  getTxConfig(
    chainId: string,
    config: TxBuilderConfigPrimitive
  ): Promise<TxBuilderConfigPrimitive>;
  // TODO: Return the `Uint8Array` instead of hex string.
  sign(
    chainId: string,
    signer: string,
    message: Uint8Array
  ): Promise<{
    signatureHex: string;
  }>;
  sendTx(
    chainId: string,
    stdTx: StdTx,
    mode: BroadcastMode
  ): Promise<Uint8Array>;
  suggestToken(chainId: string, contractAddress: string): Promise<void>;

  getEnigmaUtils(chainId: string): SecretUtils;
}
