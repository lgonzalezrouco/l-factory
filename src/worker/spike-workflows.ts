import { proxyActivities } from "@temporalio/workflow";
import type { RunStage } from "../domain/ticket/ticket.js";
import { prefix } from "./spike-const.js";

const { echo } = proxyActivities<{ echo: (stage: RunStage) => Promise<string> }>({
  startToCloseTimeout: "10 seconds",
});

export const spike = (stage: RunStage): Promise<string> =>
  echo(stage).then((r) => `${prefix}: ${r}`);
