// A Connection that confirms transactions by polling getSignatureStatuses over HTTP.
// web3.js / spl-token / Anchor confirm through the websocket signatureSubscribe by
// default; private devnet RPCs (Alchemy, ZAN) don't serve it and the public websocket
// rate-limits (429), so transactions land but confirmation times out.
import { Connection } from "@solana/web3.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PollingConnection extends Connection {
  // Overrides Connection.confirmTransaction (both the string and the blockhash-strategy forms).
  async confirmTransaction(strategy: any, _commitment?: any): Promise<any> {
    const signature: string = typeof strategy === "string" ? strategy : strategy.signature;
    const lastValidBlockHeight: number | undefined =
      typeof strategy === "string" ? undefined : strategy.lastValidBlockHeight;
    for (;;) {
      const { value: [status] } = await this.getSignatureStatuses([signature], { searchTransactionHistory: true });
      if (status?.err) return { context: { slot: status.slot }, value: { err: status.err } };
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
        return { context: { slot: status.slot }, value: { err: null } };
      }
      if (lastValidBlockHeight !== undefined && (await this.getBlockHeight("confirmed")) > lastValidBlockHeight) {
        throw new Error(`transaction ${signature} expired before confirmation`);
      }
      await sleep(1000);
    }
  }
}
