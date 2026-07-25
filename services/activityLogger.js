// services/activityLogger.js
//
// Centralized "write one activity log entry" helper, used by
// customerRoutes.js, billStatusRoutes.js, whatsappRoutes.js, and
// mikrotikRoutes.js. Logging must never break the action it's attached to,
// so every failure here is caught and swallowed (with a console.error) --
// a WhatsApp send or a bill payment succeeding is always more important
// than the audit trail succeeding.
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");

// req.user (set by middleware/auth.js) looks like { id, role, ownerId,
// assignedAreas } -- no display name. Resolve the tenant's ownerId (owners
// ARE the tenant; employees belong to one) and look up a display name.
async function resolveOwnerAndActor(reqUser) {
  if (!reqUser) {
    return { ownerId: null, performedById: null, performedByName: "", performedByRole: "" };
  }

  const ownerId = reqUser.role === "owner" ? reqUser.id : reqUser.ownerId;

  let performedByName = "";
  try {
    const user = await User.findById(reqUser.id).select("name");
    performedByName = user?.name || "";
  } catch (err) {
    // Non-fatal -- just means the log entry's performedByName is blank.
  }

  return {
    ownerId,
    performedById: reqUser.id,
    performedByName,
    performedByRole: reqUser.role || "",
  };
}

/**
 * @param {Object} params
 * @param {string} params.type - one of ActivityLog's `type` enum values
 * @param {Object} [params.reqUser] - req.user from the auth middleware (may be undefined for routes without auth)
 * @param {Object} [params.customer] - a Customer document (or plain object with _id/customerName/customerId) to denormalize
 * @param {string} params.message - short human-readable summary line
 * @param {Object} [params.details] - extra type-specific data (amount, method, phone, etc.)
 * @param {string} [params.ownerIdOverride] - use this ownerId directly instead of resolving from reqUser (e.g. resolved from the customer record when reqUser has no tenant info)
 * @param {*} [params.previousValue] - full audit trail (req 15): value before the change
 * @param {*} [params.newValue] - full audit trail: value after the change
 * @param {Object} [params.req] - the Express request object, used to capture IP/device for the audit trail. Optional -- omit for routes/background jobs with no request context.
 */
async function logActivity({ type, reqUser, customer, message, details, ownerIdOverride, previousValue, newValue, req }) {
  try {
    const { ownerId, performedById, performedByName, performedByRole } = await resolveOwnerAndActor(reqUser);
    const resolvedOwnerId = ownerIdOverride || ownerId || customer?.ownerId || null;

    if (!resolvedOwnerId) {
      console.warn(`⚠️ Skipped activity log (no ownerId resolvable) for type=${type}: ${message}`);
      return;
    }

    const ipAddress = req ? (req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "") : "";
    const deviceInfo = req ? (req.headers?.["user-agent"] || "") : "";

    await ActivityLog.create({
      type,
      ownerId: resolvedOwnerId,
      customerId: customer?._id || null,
      customerName: customer?.customerName || "",
      customerBusinessId: customer?.customerId || "",
      performedById,
      performedByName,
      performedByRole,
      message,
      details: details || {},
      previousValue: previousValue !== undefined ? previousValue : null,
      newValue: newValue !== undefined ? newValue : null,
      ipAddress,
      deviceInfo,
    });
  } catch (err) {
    console.error("❌ Failed to write activity log:", err.message);
  }
}

module.exports = { logActivity, resolveOwnerAndActor };
