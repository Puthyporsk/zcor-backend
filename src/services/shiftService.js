// src/services/shiftService.js
import Shift from "../models/Shift.js";
import { badRequest, forbidden, notFound, conflict } from "../utils/httpError.js";

const isManagerLike = (role) => role === "owner" || role === "manager";

function requireSameBusiness(reqBusinessId, docBusinessId) {
  if (String(reqBusinessId) !== String(docBusinessId)) {
    throw forbidden("Cross-tenant access is not allowed");
  }
}

function parseDate(d, fieldName) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) throw badRequest(`Invalid ${fieldName}`);
  return dt;
}

async function ensureNoShiftOverlap({ businessId, userId, startAt, endAt, excludeShiftId = null }) {
  if (!userId) return;

  const q = {
    business: businessId,
    user: userId,
    status: { $ne: "canceled" },
    ...(excludeShiftId ? { _id: { $ne: excludeShiftId } } : {}),
    // overlap if existing.start < newEnd AND existing.end > newStart
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };

  const overlap = await Shift.findOne(q).select("_id startAt endAt").lean();
  if (overlap) throw conflict("Shift overlaps an existing shift for this user");
}

export async function createShift({
  businessId,
  actor,
  userId = null,
  locationId = null,
  startAt,
  endAt,
  roleTag,
  notes,
}) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can create shifts");

  const s = parseDate(startAt, "startAt");
  const e = parseDate(endAt, "endAt");
  if (e <= s) throw badRequest("endAt must be after startAt");

  await ensureNoShiftOverlap({ businessId, userId, startAt: s, endAt: e });

  const shift = await Shift.create({
    business: businessId,
    user: userId || null,
    location: locationId || null,
    startAt: s,
    endAt: e,
    roleTag: roleTag || undefined,
    notes: notes || undefined,
    status: "draft",
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  return shift;
}

export async function updateShift({
  businessId,
  actor,
  shiftId,
  userId,
  locationId,
  startAt,
  endAt,
  roleTag,
  notes,
}) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can update shifts");

  const shift = await Shift.findById(shiftId);
  if (!shift) throw notFound("Shift not found");
  requireSameBusiness(businessId, shift.business);

  if (shift.status === "canceled") throw conflict("Canceled shifts cannot be edited");

  // Update fields if provided
  const nextStart = startAt ? parseDate(startAt, "startAt") : shift.startAt;
  const nextEnd = endAt ? parseDate(endAt, "endAt") : shift.endAt;
  if (nextEnd <= nextStart) throw badRequest("endAt must be after startAt");

  const nextUser = userId !== undefined ? (userId || null) : shift.user;

  await ensureNoShiftOverlap({
    businessId,
    userId: nextUser,
    startAt: nextStart,
    endAt: nextEnd,
    excludeShiftId: shift._id,
  });

  shift.startAt = nextStart;
  shift.endAt = nextEnd;

  if (userId !== undefined) shift.user = userId || null;
  if (locationId !== undefined) shift.location = locationId || null;
  if (roleTag !== undefined) shift.roleTag = roleTag || undefined;
  if (notes !== undefined) shift.notes = notes || undefined;

  shift.updatedBy = actor._id;

  await shift.save();
  return shift;
}

export async function publishShift({ businessId, actor, shiftId }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can publish shifts");

  const shift = await Shift.findById(shiftId);
  if (!shift) throw notFound("Shift not found");
  requireSameBusiness(businessId, shift.business);

  if (shift.status === "canceled") throw conflict("Canceled shifts cannot be published");

  // publishing requires valid times already ensured by schema
  shift.status = "published";
  shift.publishedAt = new Date();
  shift.updatedBy = actor._id;

  await shift.save();
  return shift;
}

export async function cancelShift({ businessId, actor, shiftId }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can cancel shifts");

  const shift = await Shift.findById(shiftId);
  if (!shift) throw notFound("Shift not found");
  requireSameBusiness(businessId, shift.business);

  if (shift.status === "canceled") return shift;

  shift.status = "canceled";
  shift.updatedBy = actor._id;
  await shift.save();

  return shift;
}

export async function assignShift({ businessId, actor, shiftId, userId }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can assign shifts");
  if (!userId) throw badRequest("userId is required");

  const shift = await Shift.findById(shiftId);
  if (!shift) throw notFound("Shift not found");
  requireSameBusiness(businessId, shift.business);

  if (shift.status === "canceled") throw conflict("Canceled shifts cannot be assigned");

  await ensureNoShiftOverlap({
    businessId,
    userId,
    startAt: shift.startAt,
    endAt: shift.endAt,
    excludeShiftId: shift._id,
  });

  shift.user = userId;
  shift.updatedBy = actor._id;
  await shift.save();

  return shift;
}

export async function unassignShift({ businessId, actor, shiftId }) {
  if (!isManagerLike(actor.role)) throw forbidden("Only managers/owners can unassign shifts");

  const shift = await Shift.findById(shiftId);
  if (!shift) throw notFound("Shift not found");
  requireSameBusiness(businessId, shift.business);

  if (shift.status === "canceled") throw conflict("Canceled shifts cannot be unassigned");

  shift.user = null;
  shift.updatedBy = actor._id;
  await shift.save();

  return shift;
}

export async function getShift({ businessId, actor, shiftId }) {
  const shift = await Shift.findById(shiftId)
    .populate("user", "firstName lastName displayName email role")
    .lean();

  if (!shift) throw notFound("Shift not found");
  requireSameBusiness(businessId, shift.business);

  // Employees can only view their own shifts, OR open published shifts
  if (!isManagerLike(actor.role)) {
    const isMine = shift.user?._id && String(shift.user._id) === String(actor._id);
    const isOpenPublished = !shift.user && shift.status === "published";
    if (!isMine && !isOpenPublished) throw forbidden("You can only view your own shifts");
  }

  return shift;
}

export async function listShifts({ businessId, actor, from, to, userId, status, mine = false, includeOpen = true }) {
  const q = Shift.find().byBusiness(businessId);

  // Employees default to only theirs (and optionally open published)
  if (!isManagerLike(actor.role)) {
    q.where({
      $or: [
        { user: actor._id },
        ...(includeOpen ? [{ user: null, status: "published" }] : []),
      ],
    });
  } else {
    const filterUser = mine ? actor._id : userId;
    if (filterUser) q.where({ user: filterUser });
    if (status) q.where({ status });
  }

  if (from) q.where({ startAt: { $gte: new Date(from) } });
  if (to) q.where({ startAt: { ...(q.getQuery().startAt || {}), $lte: new Date(to) } });

  q.sort({ startAt: 1 });

  // Managers often want to see who’s assigned
  if (isManagerLike(actor.role)) q.populate("user", "firstName lastName displayName email role");

  return q.lean();
}
