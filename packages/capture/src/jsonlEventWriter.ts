import { open, type FileHandle } from "node:fs/promises";
import type { CaptureEvent } from "./captureEvents.js";

export type JsonlEventWriter = {
  write(event: CaptureEvent): Promise<void>;
  close(): Promise<void>;
};

export async function createJsonlEventWriter(eventsPath: string): Promise<JsonlEventWriter> {
  const file = await open(eventsPath, "w");
  return new FileHandleJsonlEventWriter(file);
}

class FileHandleJsonlEventWriter implements JsonlEventWriter {
  private closed = false;

  constructor(private readonly file: FileHandle) {}

  async write(event: CaptureEvent): Promise<void> {
    if (this.closed) {
      throw new Error("Cannot write to a closed capture event writer.");
    }

    await this.file.appendFile(`${JSON.stringify(event)}\n`, "utf8");
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.file.close();
  }
}
