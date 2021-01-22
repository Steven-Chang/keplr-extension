import { Message } from "../message";
import { Handler } from "../handler";
import { Result } from "../interfaces";
import { EnvProducer, Guard, MessageSender } from "../types";
import { MessageRegistry } from "../encoding";
import { JSONUint8Array } from "../json-uint8-array";

export class Router {
  protected msgRegistry: MessageRegistry = new MessageRegistry();
  protected registeredHandler: Map<string, Handler> = new Map();

  protected guards: Guard[] = [];

  protected port = "";

  constructor(protected readonly envProducer: EnvProducer) {}

  public registerMessage(
    msgCls: { new (...args: any): Message<unknown> } & { type(): string }
  ): void {
    this.msgRegistry.registerMessage(msgCls);
  }

  public addHandler(route: string, handler: Handler) {
    if (this.registeredHandler.has(route)) {
      throw new Error(`Already registered type ${route}`);
    }

    this.registeredHandler.set(route, handler);
  }

  public addGuard(guard: Guard): void {
    this.guards.push(guard);
  }

  public listen(port: string) {
    if (!port) {
      throw new Error("Empty port");
    }

    this.port = port;
    browser.runtime.onMessage.addListener(this.onMessage);
    browser.runtime.onMessageExternal.addListener(this.onMessage);
  }

  public unlisten(): void {
    this.port = "";
    browser.runtime.onMessage.removeListener(this.onMessage);
    browser.runtime.onMessageExternal.removeListener(this.onMessage);
  }

  protected onMessage = async (
    message: any,
    sender: MessageSender
  ): Promise<Result | undefined> => {
    if (message.port !== this.port) {
      return;
    }

    try {
      const msg = JSONUint8Array.unwrap(this.msgRegistry.parseMessage(message));
      const env = this.envProducer(sender);

      for (const guard of this.guards) {
        await guard(env, msg, sender);
      }

      // Can happen throw
      msg.validateBasic();

      const route = msg.route();
      if (!route) {
        throw new Error("Null router");
      }
      const handler = this.registeredHandler.get(route);
      if (!handler) {
        throw new Error("Can't get handler");
      }

      const result = JSONUint8Array.wrap(await handler(env, msg));
      return Promise.resolve({
        return: result,
      });
    } catch (e) {
      console.log(
        `Failed to process msg ${message.type}: ${e?.message || e?.toString()}`
      );
      if (e) {
        return Promise.resolve({
          error: e.message || e.toString(),
        });
      } else {
        return Promise.resolve({
          error: "Unknown error, and error is null",
        });
      }
    }
  };
}
