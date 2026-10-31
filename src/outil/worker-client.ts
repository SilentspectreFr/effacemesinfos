import type { WorkerRequest, WorkerResponse } from "../worker/protocol";

type Pending = { resolve: (response: WorkerResponse) => void; reject: (error: Error) => void };

type Request = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export const engineUnavailableMessage = "Le moteur de traitement des PDF et des Word n'a pas pu se charger dans ce navigateur. Les fichiers texte et le texte collé restent utilisables. Essayez avec une version récente de Chrome, Firefox, Edge ou Safari (16.4 ou plus récent), de préférence sur un ordinateur. Si le problème persiste, signalez-le avec le lien « signaler un problème » en bas de page, en indiquant votre navigateur et votre appareil.";

const engineUnavailable = (detail: string) => detail ? `${engineUnavailableMessage} Détail technique : ${detail}` : engineUnavailableMessage;

export class EngineClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private next = 1;
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL("../worker/worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve, reject) => {
      this.worker.addEventListener("error", (event) => reject(new Error(engineUnavailable(event.message))));
      this.worker.addEventListener("message", ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === "ready") {
          resolve();
          return;
        }
        if (data.id === 0 && data.type === "error") {
          reject(new Error(engineUnavailable(data.message)));
          return;
        }
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id);
        if (data.type === "error") pending.reject(new Error(data.message));
        else pending.resolve(data);
      });
    });
  }

  call<T extends WorkerResponse["type"]>(request: Request, transfer: Transferable[] = []): Promise<Extract<WorkerResponse, { type: T }>> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending["resolve"], reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error("Session effacée."));
    this.pending.clear();
    this.ready.catch(() => undefined);
  }
}
