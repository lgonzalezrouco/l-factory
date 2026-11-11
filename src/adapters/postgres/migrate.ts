import { Migrator } from "effect/sql";
import tickets from "./migrations/0001_tickets.js";
import tenancy from "./migrations/0002_tenancy.js";
import approve from "./migrations/0003_approve.js";
import notifications from "./migrations/0004_notifications.js";

export const migrate = Migrator.make({})({
  loader: Migrator.fromRecord({
    "0001_tickets": tickets,
    "0002_tenancy": tenancy,
    "0003_approve": approve,
    "0004_notifications": notifications,
  }),
});
