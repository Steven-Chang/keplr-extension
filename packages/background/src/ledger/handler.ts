import { Env, Handler, InternalHandler, Message } from "@keplr/router";
import { LedgerGetWebHIDFlagMsg, LedgerSetWebHIDFlagMsg } from "./messages";
import { LedgerKeeper } from "./keeper";

export const getHandler: (keeper: LedgerKeeper) => Handler = (
  keeper: LedgerKeeper
) => {
  return (env: Env, msg: Message<unknown>) => {
    switch (msg.constructor) {
      case LedgerGetWebHIDFlagMsg:
        return handleLedgerGetWebHIDFlagMsg(keeper)(
          env,
          msg as LedgerGetWebHIDFlagMsg
        );
      case LedgerSetWebHIDFlagMsg:
        return handleLedgerSetWebHIDFlagMsg(keeper)(
          env,
          msg as LedgerSetWebHIDFlagMsg
        );
      default:
        throw new Error("Unknown msg type");
    }
  };
};

const handleLedgerGetWebHIDFlagMsg: (
  keeper: LedgerKeeper
) => InternalHandler<LedgerGetWebHIDFlagMsg> = (keeper) => {
  return async (_env, _msg) => {
    return await keeper.getWebHIDFlag();
  };
};

const handleLedgerSetWebHIDFlagMsg: (
  keeper: LedgerKeeper
) => InternalHandler<LedgerSetWebHIDFlagMsg> = (keeper) => {
  return async (_env, msg) => {
    return await keeper.setWebHIDFlag(msg.flag);
  };
};
