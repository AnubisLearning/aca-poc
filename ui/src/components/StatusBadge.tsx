import React from "react";
import type { JobStatus } from "../types";
import { clsx } from "clsx";

const STATUS_STYLES: Record<JobStatus, string> = {
  pending: "bg-gray-700 text-gray-300",
  running: "bg-blue-900 text-blue-300 animate-pulse",
  paused: "bg-amber-900 text-amber-300",
  completed: "bg-emerald-900 text-emerald-300",
  failed: "bg-red-900 text-red-300",
  cancelled: "bg-gray-700 text-gray-400",
};

interface Props {
  status: JobStatus;
}

export const StatusBadge: React.FC<Props> = ({ status }) => (
  <span className={clsx("badge font-medium capitalize", STATUS_STYLES[status])}>
    {status}
  </span>
);
