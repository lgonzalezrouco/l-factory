import { Migrator } from "effect/sql";
import tickets from "./migrations/0001_tickets.js";
import tenancy from "./migrations/0002_tenancy.js";

export const migrate = Migrator.make({})({
  loader: Migrator.fromRecord({ "0001_tickets": tickets, "0002_tenancy": tenancy }),
});
