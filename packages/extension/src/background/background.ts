import {
  Router,
  ExtensionGuards,
  ExtensionEnv,
  BACKGROUND_PORT,
} from "@keplr/router";
import { ExtensionKVStore } from "@keplr/common";
import { init } from "@keplr/background";

import { EmbedChainInfos } from "../config";

const router = new Router(ExtensionEnv.produceEnv);
router.addGuard(ExtensionGuards.checkOriginIsValid);
router.addGuard(ExtensionGuards.checkMessageIsInternal);

init(
  router,
  (prefix: string) => new ExtensionKVStore(prefix),
  EmbedChainInfos,
  (array) => {
    return Promise.resolve(crypto.getRandomValues(array));
  }
);

router.listen(BACKGROUND_PORT);
