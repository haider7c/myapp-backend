const mongoose = require("mongoose");

// Persists "the last calendar day this background job successfully
// completed" for idempotent scheduled jobs (currently: the MikroTik expiry
// disable/disconnect passes). Without this, that bookkeeping lived only in
// an in-memory variable, which a server restart always wipes back to
// null — so any restart occurring after the job's scheduled time made the
// "did we already run today?" check forget the answer and re-run the pass,
// re-disabling customers who staff had already manually re-enabled earlier
// that same day (e.g. right after they paid).
const schedulerStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    lastRunDayKey: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SchedulerState", schedulerStateSchema);
