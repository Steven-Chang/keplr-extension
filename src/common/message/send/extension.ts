import { MessageRequester } from "../types";
import { Message } from "../message";

export class InExtensionMessageRequester implements MessageRequester {
  async sendMessage<M extends Message<unknown>>(
    port: string,
    msg: M
  ): Promise<M extends Message<infer R> ? R : never> {
    msg.validateBasic();

    return await browser.runtime.sendMessage({
      port,
      type: msg.type(),
      msg
    });
  }
}
