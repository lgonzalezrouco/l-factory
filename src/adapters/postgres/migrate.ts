import { Migrator } from "effect/sql";
import tickets from "./migrations/0001_tickets.js";

export const migrate = Migrator.make({})({
  loader: Migrator.fromRecord({ "0001_tickets": tickets }),
});
