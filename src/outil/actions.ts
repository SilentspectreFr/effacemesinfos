import type { State, Step } from "./state";

export interface Actions {
  state: State;
  render(): void;
  back(step: Step): void;
  openFile(file: File): void;
  openText(text: string, name?: string): void;
  syncLocated(): Promise<void>;
  produce(rasterizePages?: number[]): void;
  notify(message: string): void;
  imageUrl(key: string): Promise<string | null>;
  readScan(): void;
  stopReading(): void;
}
