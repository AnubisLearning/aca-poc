import { io, Socket } from "socket.io-client";
import type { JobEvent } from "./types";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io("/", {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => console.log("[WS] connected", socket?.id));
    socket.on("disconnect", () => console.log("[WS] disconnected"));
  }
  return socket;
}

export function subscribeToJob(jobId: string) {
  getSocket().emit("subscribe_job", jobId);
}

export function unsubscribeFromJob(jobId: string) {
  getSocket().emit("unsubscribe_job", jobId);
}

export function subscribeToAll() {
  getSocket().emit("subscribe_all");
}

export function onJobEvent(handler: (event: JobEvent) => void) {
  getSocket().on("job_event", handler);
  return () => { getSocket().off("job_event", handler); };
}
