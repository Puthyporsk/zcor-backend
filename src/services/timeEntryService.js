// services/timeEntryService.js
import TimeEntry from "../models/TimeEntry.js";
import User from "../models/User.js";
import Business from "../models/Business.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/httpError.js";
import { computeManualTotals, timeToMinutes } from "../utils/timeMath.js";

function isManagerLike(role) {
  return role === "owner" || role === "manager";
}

async function getBusinessSettings(businessId) {
  const biz = await Business.findById(businessId).select("settings").lean();
  return biz?.settings || {};
}

async function ensureUserInBusiness(businessId, userId) {
  const u = await User.findOne({ _id: userId, business: businessId }).select("_id role status").lean();
  if (!u) throw notFound("User not found in this business");
  if (u.status === "deleted" || u.status === "disabled") throw forbidden("User is not active");
  return u;
}

function requireSameBusiness(reqBusinessId, docBusinessId) {
  if (String(reqBusinessId) !== String(docBusinessId)) {
    throw forbidden("Cross-tenant access is not allowed");
  }
}

function ensureManual(entry) {
  if (!entry || entry.entryType !== "manual") {
    throw notFound("Manual time entry not found");
  }
}

function isEditableStatus(status) {
  return status === "draft" || status === "rejected";
}

/**
 * Overlap rule (manual):
 * For same business + user + workDate (YYYY-MM-DD),
 * intervals overlap if existing.start < newEnd && existing.end > newStart.
 */
async function ensureNoManualOverlap({
  businessId,
  userId,
  workDate,
  startTime,
  endTime,
  excludeEntryId = null,
}) {
  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);
  if (newEnd <= newStart) throw badRequest("endTime must be after startTime");

  const q = {
    business: businessId,
    entryType: "manual",
    user: userId,
    workDate,
    status: { $ne: "void" },
    ...(excludeEntryId ? { _id: { $ne: excludeEntryId } } : {}),
  };

  const existing = await TimeEntry.find(q).select("_id startTime endTime").lean();

  for (const e of existing) {
    // skip malformed legacy
    if (!e.startTime || !e.endTime) continue;
    const s = timeToMinutes(e.startTime);
    const en = timeToMinutes(e.endTime);
    if (s < newEnd && en > newStart) {
      throw conflict("Time entry overlaps an existing entry on the same date");
    }
  }
}

export async function createManualTimeEntry({
  businessId,
  actor,
  targetUserId,
  workDate,     // "YYYY-MM-DD"
  startTime,    // "HH:mm"
  endTime,      // "HH:mm"
  breakMinutes, // number
  notes,
  locationId,
}) {
  const userId = targetUserId || actor._id;

  // RBAC: employees can only create for themselves
  if (!isManagerLike(actor.role) && String(userId) !== String(actor._id)) {
    throw forbidden("Employees can only create their own time entries");
  }

  await ensureUserInBusiness(businessId, userId);

  if (!workDate) throw badRequest("workDate is required (YYYY-MM-DD)");
  if (!startTime) throw badRequest("startTime is required (HH:mm)");
  if (!endTime) throw badRequest("endTime is required (HH:mm)");

  // Validate & compute (also validates breakMinutes vs duration)
  try {
    computeManualTotals({ startTime, endTime, breakMinutes });
  } catch (e) {
    throw badRequest(e.message);
  }

  await ensureNoManualOverlap({
    businessId,
    userId,
    workDate,
    startTime,
    endTime,
  });

  const entry = await TimeEntry.create({
    business: businessId,
    user: userId,
    entryType: "manual",
    workDate,
    startTime,
    endTime,
    breakMinutes: Number(breakMinutes || 0),
    notes: notes || undefined,
    location: locationId || undefined,
    status: "draft",
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  return entry;
}

export async function updateManualTimeEntry({
  businessId,
  actor,
  entryId,
  workDate,
  startTime,
  endTime,
  breakMinutes,
  notes,
  locationId,
}) {
  const entry = await TimeEntry.findById(entryId);
  if (!entry) throw notFound("Time entry not found");
  requireSameBusiness(businessId, entry.business);
  ensureManual(entry);

  // RBAC: employees can only edit their own
  if (!isManagerLike(actor.role) && String(entry.user) !== String(actor._id)) {
    throw forbidden("Employees can only edit their own time entry");
  }

  if (!isEditableStatus(entry.status)) {
    throw conflict("Only draft or rejected entries can be edited");
  }

  const nextWorkDate = workDate ?? entry.workDate;
  const nextStart = startTime ?? entry.startTime;
  const nextEnd = endTime ?? entry.endTime;
  const nextBreak = breakMinutes ?? entry.breakMinutes;

  // Validate totals
  try {
    computeManualTotals({ startTime: nextStart, endTime: nextEnd, breakMinutes: nextBreak });
  } catch (e) {
    throw badRequest(e.message);
  }

  await ensureNoManualOverlap({
    businessId,
    userId: entry.user,
    workDate: nextWorkDate,
    startTime: nextStart,
    endTime: nextEnd,
    excludeEntryId: entry._id,
  });

  entry.workDate = nextWorkDate;
  entry.startTime = nextStart;
  entry.endTime = nextEnd;
  entry.breakMinutes = Number(nextBreak || 0);

  if (notes !== undefined) entry.notes = notes || undefined;
  if (locationId !== undefined) entry.location = locationId || undefined;

  entry.updatedBy = actor._id;
  await entry.save();

  return entry;
}

export async function submitTimeEntry({ businessId, actor, entryId }) {
  const entry = await TimeEntry.findById(entryId);
  if (!entry) throw notFound("Time entry not found");
  requireSameBusiness(businessId, entry.business);
  ensureManual(entry);

  if (!isManagerLike(actor.role) && String(entry.user) !== String(actor._id)) {
    throw forbidden("Employees can only submit their own time entry");
  }

  if (!isEditableStatus(entry.status)) {
    throw conflict("Only draft or rejected entries can be submitted");
  }

  // Validate totals before submit
  try {
    computeManualTotals({ startTime: entry.startTime, endTime: entry.endTime, breakMinutes: entry.breakMinutes });
  } catch (e) {
    throw badRequest(e.message);
  }

  entry.status = "submitted";
  entry.submittedAt = new Date();
  entry.updatedBy = actor._id;

  await entry.save();
  return entry;
}

export async function approveTimeEntry({ businessId, actor, entryId }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can approve time entries");

  const entry = await TimeEntry.findById(entryId);
  if (!entry) throw notFound("Time entry not found");
  requireSameBusiness(businessId, entry.business);
  ensureManual(entry);

  if (entry.status !== "submitted") throw conflict("Only submitted time entries can be approved");

  entry.status = "approved";
  entry.approvedBy = actor._id;
  entry.approvedAt = new Date();
  entry.updatedBy = actor._id;

  await entry.save();
  return entry;
}

export async function rejectTimeEntry({ businessId, actor, entryId, reason }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can reject time entries");
  if (!reason || String(reason).trim().length < 2) throw badRequest("Rejection reason is required");

  const entry = await TimeEntry.findById(entryId);
  if (!entry) throw notFound("Time entry not found");
  requireSameBusiness(businessId, entry.business);
  ensureManual(entry);

  if (entry.status !== "submitted") throw conflict("Only submitted time entries can be rejected");

  entry.status = "rejected";
  entry.rejectionReason = String(reason).trim();
  entry.updatedBy = actor._id;

  await entry.save();
  return entry;
}

export async function voidTimeEntry({ businessId, actor, entryId }) {
  const entry = await TimeEntry.findById(entryId);
  if (!entry) throw notFound("Time entry not found");
  requireSameBusiness(businessId, entry.business);
  ensureManual(entry);

  // Employees can void their own ONLY if draft/rejected
  if (!isManagerLike(actor.role)) {
    if (String(entry.user) !== String(actor._id)) throw forbidden("Employees can only void their own time entry");
    if (!isEditableStatus(entry.status)) throw conflict("You can only void draft or rejected entries");
  }

  entry.status = "void";
  entry.updatedBy = actor._id;
  await entry.save();

  return entry;
}

export async function listTimeEntries({ businessId, actor, userId, from, to, status, mine = false }) {
  const filterUserId = mine ? actor._id : userId;

  // Employees can only list theirs
  if (!isManagerLike(actor.role) && !mine && filterUserId && String(filterUserId) !== String(actor._id)) {
    throw forbidden("Employees can only view their own time entries");
  }

  const q = TimeEntry.find().byBusiness(businessId).where({ entryType: "manual" });

  if (filterUserId) q.where({ user: filterUserId });
  if (status) q.where({ status });

  // Range on YYYY-MM-DD strings (lex order matches date order)
  if (from) q.where({ workDate: { $gte: String(from) } });
  if (to) q.where({ workDate: { ...(q.getQuery().workDate || {}), $lte: String(to) } });

  q.sort({ workDate: -1, startTime: -1 });

  if (isManagerLike(actor.role)) {
    q.populate("user", "firstName lastName displayName email role");
  }

  return q.lean();
}

export async function getTimeEntry({ businessId, actor, entryId }) {
  const entry = await TimeEntry.findById(entryId)
    .populate("user", "firstName lastName displayName email role business")
    .lean();

  if (!entry) throw notFound("Time entry not found");
  requireSameBusiness(businessId, entry.business);

  if (entry.entryType !== "manual") throw notFound("Manual time entry not found");

  if (!isManagerLike(actor.role) && String(entry.user?._id) !== String(actor._id)) {
    throw forbidden("Employees can only view their own time entry");
  }

  const settings = await getBusinessSettings(businessId);
  const roundingMinutes = settings?.timeTracking?.roundingMinutes || 0;

  let totals;
  try {
    totals = computeManualTotals(
      { startTime: entry.startTime, endTime: entry.endTime, breakMinutes: entry.breakMinutes },
      { roundingMinutes, roundingMode: "nearest" }
    );
  } catch (e) {
    totals = { error: e.message };
  }

  return { ...entry, totals };
}

export async function listPendingTimeEntries({ businessId, actor, from, to, userId }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can view pending approvals");

  const q = TimeEntry.find()
    .byBusiness(businessId)
    .where({ entryType: "manual", status: "submitted" });

  if (userId) q.where({ user: userId });

  // from/to are YYYY-MM-DD strings
  if (from) q.where({ workDate: { $gte: String(from) } });
  if (to) q.where({ workDate: { ...(q.getQuery().workDate || {}), $lte: String(to) } });

  q.sort({ workDate: -1, startTime: -1 }).populate("user", "firstName lastName displayName email role");

  return q.lean();
}

// ✅ NEW: Bulk approve
export async function bulkApproveTimeEntries({ businessId, actor, entryIds }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can approve time entries");
  if (!Array.isArray(entryIds) || entryIds.length === 0) throw badRequest("entryIds must be a non-empty array");

  // Only approve submitted manual entries in this tenant
  const approvedAt = new Date();

  const result = await TimeEntry.updateMany(
    {
      _id: { $in: entryIds },
      business: businessId,
      entryType: "manual",
      status: "submitted",
    },
    {
      $set: {
        status: "approved",
        approvedBy: actor._id,
        approvedAt,
        updatedBy: actor._id,
      },
    }
  );

  // Return the updated documents (optional but helpful for UI refresh)
  const updated = await TimeEntry.find({
    _id: { $in: entryIds },
    business: businessId,
    entryType: "manual",
  })
    .populate("user", "firstName lastName displayName email role")
    .lean();

  return {
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
    updated,
  };
}

// ✅ NEW: Bulk reject
export async function bulkRejectTimeEntries({ businessId, actor, entryIds, reason }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can reject time entries");
  if (!Array.isArray(entryIds) || entryIds.length === 0) throw badRequest("entryIds must be a non-empty array");
  if (!reason || String(reason).trim().length < 2) throw badRequest("Rejection reason is required");

  const rejectionReason = String(reason).trim();

  const result = await TimeEntry.updateMany(
    {
      _id: { $in: entryIds },
      business: businessId,
      entryType: "manual",
      status: "submitted",
    },
    {
      $set: {
        status: "rejected",
        rejectionReason,
        updatedBy: actor._id,
      },
    }
  );

  const updated = await TimeEntry.find({
    _id: { $in: entryIds },
    business: businessId,
    entryType: "manual",
  })
    .populate("user", "firstName lastName displayName email role")
    .lean();

  return {
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
    updated,
  };
}

// ✅ NEW: Summary endpoint for Time Entry page (counts + totals)
export async function getTimeEntrySummary({ businessId, actor, from, to, mine = false, userId }) {
  const targetUserId = mine ? actor._id : userId;

  // Employees can only see their own summary
  if (!isManagerLike(actor.role) && (!mine || (targetUserId && String(targetUserId) !== String(actor._id)))) {
    throw forbidden("Employees can only view their own time entry summary");
  }

  const q = TimeEntry.find()
    .byBusiness(businessId)
    .where({ entryType: "manual" });

  if (targetUserId) q.where({ user: targetUserId });
  if (from) q.where({ workDate: { $gte: String(from) } });
  if (to) q.where({ workDate: { ...(q.getQuery().workDate || {}), $lte: String(to) } });

  const entries = await q.select("workDate startTime endTime breakMinutes status user").lean();

  const settings = await getBusinessSettings(businessId);
  const roundingMinutes = settings?.timeTracking?.roundingMinutes || 0;

  const counts = { draft: 0, submitted: 0, approved: 0, rejected: 0, void: 0 };
  let totalPaidMinutes = 0;
  let totalPaidMinutesRounded = 0;
  let totalBreakMinutes = 0;

  for (const e of entries) {
    if (counts[e.status] !== undefined) counts[e.status] += 1;

    try {
      const totals = computeManualTotals(
        { startTime: e.startTime, endTime: e.endTime, breakMinutes: e.breakMinutes },
        { roundingMinutes, roundingMode: "nearest" }
      );
      totalPaidMinutes += totals.paidMinutes;
      totalPaidMinutesRounded += totals.paidMinutesRounded;
      totalBreakMinutes += totals.breakMinutes;
    } catch {
      // ignore malformed rows
    }
  }

  return {
    range: { from: from || null, to: to || null },
    counts,
    totals: {
      totalPaidMinutes,
      totalPaidMinutesRounded,
      totalBreakMinutes,
    },
  };
}
