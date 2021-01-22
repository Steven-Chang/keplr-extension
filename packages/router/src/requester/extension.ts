import { MessageRequester } from "../types";
import { Message } from "../message";
import { JSONUint8Array } from "../json-uint8-array";

export class InExtensionMessageRequester implements MessageRequester {
  async sendMessage<M extends Message<unknown>>(
    port: string,
    msg: M
  ): Promise<M extends Message<infer R> ? R : never> {
    msg.validateBasic();

    // Set message's origin.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    msg["origin"] = window.location.origin;

    return JSONUint8Array.unwrap(
      (
        await browser.runtime.sendMessage({
          port,
          type: msg.type(),
          msg: JSONUint8Array.wrap(msg),
        })
      ).return
    );
  }

  static async sendMessageToTab<M extends Message<unknown>>(
    tabId: number,
    port: string,
    msg: M
  ): Promise<M extends Message<infer R> ? R : never> {
    msg.validateBasic();

    // Set message's origin.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    msg["origin"] = window.location.origin;

    return JSONUint8Array.unwrap(
      (
        await browser.tabs.sendMessage(tabId, {
          port,
          type: msg.type(),
          msg: JSONUint8Array.wrap(msg),
        })
      ).return
    );
  }
}
