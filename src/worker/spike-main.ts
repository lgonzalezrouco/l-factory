import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";

const connection = await NativeConnection.connect({ address: "localhost:7233" });
const worker = await Worker.create({
  connection,
  taskQueue: "spike",
  workflowsPath: fileURLToPath(import.meta.resolve("./spike-workflows.js")),
  activities: { echo: async (stage: string) => `echo ${stage}` },
});
const client = new Client({ connection: await Connection.connect({ address: "localhost:7233" }) });
const result = await worker.runUntil(
  client.workflow.execute("spike", {
    taskQueue: "spike",
    workflowId: `spike-${Date.now()}`,
    args: ["triage"],
  }),
);
console.log("spike result:", result);
