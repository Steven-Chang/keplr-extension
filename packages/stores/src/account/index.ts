import { HasMapStore } from "../common";
import { KVStore } from "@keplr/common";
import { ChainGetter } from "../common/types";
import { computed, observable, runInAction } from "mobx";
import { actionAsync, task } from "mobx-utils";
import { Keplr } from "@keplr/types";
import { BaseAccount } from "@keplr/cosmos";
import Axios, { AxiosInstance } from "axios";
import {
  BroadcastMode,
  BroadcastTxResult,
  encodeSecp256k1Signature,
  makeSignDoc,
  makeStdTx,
  Msg,
  serializeSignDoc,
  StdFee
} from "@cosmjs/launchpad";
import { fromHex } from "@cosmjs/encoding";
import { Coin, Dec, DecUtils } from "@keplr/unit";
import { BondStatus, QueriesStore } from "../query";
import { Queries } from "../query/queries";
import PQueue from "p-queue";

export enum WalletStatus {
  Loading = "Loading",
  Loaded = "Loaded",
  NotExist = "NotExist"
}

export interface AccountStoreInnerOpts {
  reinitializeWhenKeyStoreChanged: boolean;
}

export class AccountStoreInner {
  @observable
  protected _walletStatus!: WalletStatus;

  @observable
  protected _name!: string;

  @observable
  protected _bech32Address!: string;

  @observable
  protected _isSendingMsg!: boolean;

  protected pubKey: Uint8Array;

  // If there are multiple enabling at the same time,
  // keplr wallet works somewhat strangely.
  // So to solve this problem, just make enabling execute sequently.
  protected static enablingQueue: PQueue = new PQueue({
    concurrency: 1
  });

  constructor(
    protected readonly kvStore: KVStore,
    protected readonly chainGetter: ChainGetter,
    protected readonly chainId: string,
    protected readonly queries: Queries,
    protected readonly opts: AccountStoreInnerOpts = {
      reinitializeWhenKeyStoreChanged: true
    }
  ) {
    runInAction(() => {
      this._walletStatus = WalletStatus.Loading;
      this._name = "";
      this._bech32Address = "";
      this._isSendingMsg = false;
    });

    this.pubKey = new Uint8Array();

    this.init();
  }

  protected async enable(keplr: Keplr, chainId: string): Promise<void> {
    const chainInfo = this.chainGetter.getChain(chainId);

    await keplr.experimentalSuggestChain(chainInfo);
    await keplr.enable(chainId);
  }

  @actionAsync
  protected readonly init = async () => {
    // If wallet status is not exist, there is no need to try to init because it always fails.
    if (this.walletStatus === WalletStatus.NotExist) {
      return;
    }

    if (this.opts.reinitializeWhenKeyStoreChanged) {
      // If key store in the keplr extension is changed, this event will be dispatched.
      window.addEventListener("keplr_keystorechange", this.init, {
        once: true
      });
    }

    // Set wallet status as loading whenever try to init.
    this._walletStatus = WalletStatus.Loading;

    const keplr = await task(this.getKeplr());
    if (!keplr) {
      this._walletStatus = WalletStatus.NotExist;
      return;
    }

    // TODO: Handle not approved.
    await task(
      AccountStoreInner.enablingQueue.add(() =>
        this.enable(keplr, this.chainId)
      )
    );

    const key = await task(keplr.getKey(this.chainId));
    this._bech32Address = key.bech32Address;
    this._name = key.name;
    this.pubKey = fromHex(key.pubKeyHex);

    // Set the wallet status as loaded after getting all necessary infos.
    this._walletStatus = WalletStatus.Loaded;
  };

  @computed
  get isReadyToSendMsgs(): boolean {
    return (
      this.walletStatus === WalletStatus.Loaded && this.bech32Address !== ""
    );
  }

  sendMsgs(
    msgs: Msg[],
    fee: StdFee,
    memo: string = "",
    mode: "block" | "async" | "sync" = "block",
    onSuccess?: () => void,
    onFail?: (e: Error) => void,
    onFulfill?: () => void
  ) {
    runInAction(() => {
      this._isSendingMsg = true;
    });
    this.broadcastMsgs(msgs, fee, memo, mode)
      .then(() => {
        if (onSuccess) {
          onSuccess();
        }
      })
      .catch(e => {
        // 아직 트랜잭션 자체가 실패했는지는 고려하지 않는다.
        // 만약 wallet status가 loaded가 아닐 경우는 오류가 뜰 것.
        // 또는 케플러에서 rejected 당할 때 오류가 뜰 것.
        // 트랜잭션 자체의 오류에 대해서도 처리해줄 필요가 있는가?
        if (onFail) {
          onFail(e);
        }
      })
      .finally(() => {
        runInAction(() => {
          this._isSendingMsg = false;
        });

        // After sending tx, the balances is probably changed due to the fee.
        this.queries
          .getQueryBalances()
          .getQueryBech32Address(this.bech32Address)
          .fetch();

        if (onFulfill) {
          onFulfill();
        }
      });
  }

  /**
   * Send `MsgDelegate` msg to the chain.
   * @param amount Decimal number used by humans.
   *               If amount is 0.1 and the stake currenct is uatom, actual amount will be changed to the 100000uatom.
   * @param validatorAddress
   * @param fee
   * @param memo
   * @param mode
   * @param onSuccess
   * @param onFail
   * @param onFulfill
   */
  sendDelegateMsg(
    amount: string,
    validatorAddress: string,
    fee: StdFee,
    memo: string = "",
    mode: "block" | "async" | "sync" = "block",
    onSuccess?: () => void,
    onFail?: (e: Error) => void,
    onFulfill?: () => void
  ) {
    const currency = this.chainGetter.getChain(this.chainId).stakeCurrency;

    let dec = new Dec(amount);
    dec = dec.mulTruncate(DecUtils.getPrecisionDec(currency.coinDecimals));

    const msg = {
      type: "cosmos-sdk/MsgDelegate",
      value: {
        // eslint-disable-next-line @typescript-eslint/camelcase
        delegator_address: this.bech32Address,
        // eslint-disable-next-line @typescript-eslint/camelcase
        validator_address: validatorAddress,
        amount: {
          denom: currency.coinMinimalDenom,
          amount: dec.truncate().toString()
        }
      }
    };

    this.sendMsgs(
      [msg],
      fee,
      memo,
      mode,
      () => {
        // After succeeding to delegate, refresh the validators and delegations, rewards.
        this.queries
          .getQueryValidators()
          .getQueryStatus(BondStatus.Bonded)
          .fetch();
        this.queries
          .getQueryDelegations()
          .getQueryBech32Address(this.bech32Address)
          .fetch();
        this.queries
          .getQueryRewards()
          .getQueryBech32Address(this.bech32Address)
          .fetch();

        if (onSuccess) {
          onSuccess();
        }
      },
      onFail,
      onFulfill
    );
  }

  /**
   * Send `MsgUndelegate` msg to the chain.
   * @param amount Decimal number used by humans.
   *               If amount is 0.1 and the stake currenct is uatom, actual amount will be changed to the 100000uatom.
   * @param validatorAddress
   * @param fee
   * @param memo
   * @param mode
   * @param onSuccess
   * @param onFail
   * @param onFulfill
   */
  sendUndelegateMsg(
    amount: string,
    validatorAddress: string,
    fee: StdFee,
    memo: string = "",
    mode: "block" | "async" | "sync" = "block",
    onSuccess?: () => void,
    onFail?: (e: Error) => void,
    onFulfill?: () => void
  ) {
    const currency = this.chainGetter.getChain(this.chainId).stakeCurrency;

    let dec = new Dec(amount);
    dec = dec.mulTruncate(DecUtils.getPrecisionDec(currency.coinDecimals));

    const msg = {
      type: "cosmos-sdk/MsgUndelegate",
      value: {
        // eslint-disable-next-line @typescript-eslint/camelcase
        delegator_address: this.bech32Address,
        // eslint-disable-next-line @typescript-eslint/camelcase
        validator_address: validatorAddress,
        amount: {
          denom: currency.coinMinimalDenom,
          amount: dec.truncate().toString()
        }
      }
    };

    this.sendMsgs(
      [msg],
      fee,
      memo,
      mode,
      () => {
        // After succeeding to unbond, refresh the validators and delegations, unbonding delegations, rewards.
        this.queries
          .getQueryValidators()
          .getQueryStatus(BondStatus.Bonded)
          .fetch();
        this.queries
          .getQueryDelegations()
          .getQueryBech32Address(this.bech32Address)
          .fetch();
        this.queries
          .getQueryUnbondingDelegations()
          .getQueryBech32Address(this.bech32Address)
          .fetch();
        this.queries
          .getQueryRewards()
          .getQueryBech32Address(this.bech32Address)
          .fetch();

        if (onSuccess) {
          onSuccess();
        }
      },
      onFail,
      onFulfill
    );
  }

  /**
   * Send `MsgBeginRedelegate` msg to the chain.
   * @param amount Decimal number used by humans.
   *               If amount is 0.1 and the stake currenct is uatom, actual amount will be changed to the 100000uatom.
   * @param srcValidatorAddress
   * @param dstValidatorAddress
   * @param fee
   * @param memo
   * @param mode
   * @param onSuccess
   * @param onFail
   * @param onFulfill
   */
  sendBeginRedelegateMsg(
    amount: string,
    srcValidatorAddress: string,
    dstValidatorAddress: string,
    fee: StdFee,
    memo: string = "",
    mode: "block" | "async" | "sync" = "block",
    onSuccess?: () => void,
    onFail?: (e: Error) => void,
    onFulfill?: () => void
  ) {
    const currency = this.chainGetter.getChain(this.chainId).stakeCurrency;

    let dec = new Dec(amount);
    dec = dec.mulTruncate(DecUtils.getPrecisionDec(currency.coinDecimals));

    const msg = {
      type: "cosmos-sdk/MsgBeginRedelegate",
      value: {
        // eslint-disable-next-line @typescript-eslint/camelcase
        delegator_address: this.bech32Address,
        // eslint-disable-next-line @typescript-eslint/camelcase
        validator_src_address: srcValidatorAddress,
        // eslint-disable-next-line @typescript-eslint/camelcase
        validator_dst_address: dstValidatorAddress,
        amount: {
          denom: currency.coinMinimalDenom,
          amount: dec.truncate().toString()
        }
      }
    };

    this.sendMsgs(
      [msg],
      fee,
      memo,
      mode,
      () => {
        // After succeeding to redelegate, refresh the validators and delegations, rewards.
        this.queries
          .getQueryValidators()
          .getQueryStatus(BondStatus.Bonded)
          .fetch();
        this.queries
          .getQueryDelegations()
          .getQueryBech32Address(this.bech32Address)
          .fetch();
        this.queries
          .getQueryRewards()
          .getQueryBech32Address(this.bech32Address)
          .fetch();

        if (onSuccess) {
          onSuccess();
        }
      },
      onFail,
      onFulfill
    );
  }

  sendWithdrawDelegationRewardMsgs(
    validatorAddresses: string[],
    fee: StdFee,
    memo: string = "",
    mode: "block" | "async" | "sync" = "block",
    onSuccess?: () => void,
    onFail?: (e: Error) => void,
    onFulfill?: () => void
  ) {
    const msgs = validatorAddresses.map(validatorAddress => {
      return {
        type: "cosmos-sdk/MsgWithdrawDelegationReward",
        value: {
          // eslint-disable-next-line @typescript-eslint/camelcase
          delegator_address: this.bech32Address,
          // eslint-disable-next-line @typescript-eslint/camelcase
          validator_address: validatorAddress
        }
      };
    });

    this.sendMsgs(
      msgs,
      fee,
      memo,
      mode,
      () => {
        // After succeeding to withdraw rewards, refresh rewards.
        this.queries
          .getQueryRewards()
          .getQueryBech32Address(this.bech32Address)
          .fetch();

        if (onSuccess) {
          onSuccess();
        }
      },
      onFail,
      onFulfill
    );
  }

  sendGovVoteMsg(
    proposalId: string,
    option: "Yes" | "No" | "Abstain" | "NoWithVeto",
    fee: StdFee,
    memo: string = "",
    mode: "block" | "async" | "sync" = "block",
    onSuccess?: () => void,
    onFail?: (e: Error) => void,
    onFulfill?: () => void
  ) {
    const msg = {
      type: "cosmos-sdk/MsgVote",
      value: {
        option,
        // eslint-disable-next-line @typescript-eslint/camelcase
        proposal_id: proposalId,
        voter: this.bech32Address
      }
    };

    this.sendMsgs(
      [msg],
      fee,
      memo,
      mode,
      () => {
        // After succeeding to vote, refresh the proposals.
        for (const proposal of this.queries.getQueryGovernance().proposals) {
          proposal.fetch();
        }

        if (onSuccess) {
          onSuccess();
        }
      },
      onFail,
      onFulfill
    );
  }

  protected async broadcastMsgs(
    msgs: Msg[],
    fee: StdFee,
    memo: string = "",
    mode: "block" | "async" | "sync" = "block"
  ): Promise<BroadcastTxResult> {
    if (this.walletStatus !== WalletStatus.Loaded) {
      throw new Error(`Wallet is not loaded: ${this.walletStatus}`);
    }

    if (msgs.length === 0) {
      throw new Error("There is no msg to send");
    }

    const account = await BaseAccount.fetchFromRest(
      this.instance,
      this.bech32Address
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const keplr = (await this.getKeplr())!;

    const txConfig = await keplr.getTxConfig(this.chainId, {
      gas: fee.gas,
      memo,
      fee: fee.amount.map(fee => `${fee.amount} ${fee.denom}`).join(",")
    });

    const signDoc = makeSignDoc(
      msgs,
      {
        gas: txConfig.gas,
        // 케플러를 cosmjs에 더 친화적으로 바꿔서 밑의 라인을 줄이자...
        amount: txConfig.fee
          ? txConfig.fee
              .split(",")
              .map(feeStr => {
                return Coin.parse(feeStr);
              })
              .map(coin => {
                return {
                  amount: coin.amount.toString(),
                  denom: coin.denom
                };
              })
          : []
      },
      this.chainId,
      txConfig.memo,
      account.getAccountNumber().toString(),
      account.getSequence().toString()
    );

    const signature = await keplr.sign(
      this.chainId,
      this.bech32Address,
      serializeSignDoc(signDoc)
    );

    const signedTx = makeStdTx(
      signDoc,
      encodeSecp256k1Signature(this.pubKey, fromHex(signature.signatureHex))
    );

    return await keplr.sendTx(this.chainId, signedTx, mode as BroadcastMode);
  }

  get instance(): AxiosInstance {
    const chainInfo = this.chainGetter.getChain(this.chainId);
    return Axios.create({
      ...{
        baseURL: chainInfo.rest
      },
      ...chainInfo.restConfig
    });
  }

  get walletStatus(): WalletStatus {
    return this._walletStatus;
  }

  get name(): string {
    return this._name;
  }

  get bech32Address(): string {
    return this._bech32Address;
  }

  get isSendingMsg(): boolean {
    return this._isSendingMsg;
  }

  protected async getKeplr(): Promise<Keplr | undefined> {
    if (window.keplr) {
      return window.keplr;
    }

    if (document.readyState === "complete") {
      return window.keplr;
    }

    return new Promise(resolve => {
      const documentStateChange = (event: Event) => {
        if (
          event.target &&
          (event.target as Document).readyState === "complete"
        ) {
          resolve(window.keplr);
          document.removeEventListener("readystatechange", documentStateChange);
        }
      };

      document.addEventListener("readystatechange", documentStateChange);
    });
  }
}

export class AccountStore extends HasMapStore<AccountStoreInner> {
  constructor(
    protected readonly kvStore: KVStore,
    protected readonly chainGetter: ChainGetter,
    protected readonly queriesStore: QueriesStore,
    accountPrefetchingChainIds: string[] = []
  ) {
    super((chainId: string) => {
      return new AccountStoreInner(
        this.kvStore,
        this.chainGetter,
        chainId,
        this.queriesStore.get(chainId)
      );
    });

    for (const chainId of accountPrefetchingChainIds) {
      this.getAccount(chainId);
    }
  }

  getAccount(chainId: string): AccountStoreInner {
    return this.get(chainId);
  }
}