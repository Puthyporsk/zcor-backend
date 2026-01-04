// routes/timeEntries.js
import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import requireRole from "../middleware/requireRole.js";
import {
  createManualTimeEntry,
  updateManualTimeEntry,
  submitTimeEntry,
  approveTimeEntry,
  rejectTimeEntry,
  voidTimeEntry,
  listTimeEntries,
  getTimeEntry,
  listPendingTimeEntries,
  bulkApproveTimeEntries,
  bulkRejectTimeEntries,
  getTimeEntrySummary,
} from "../services/timeEntryService.js";

const router = Router();

/**
 * GET /api/time-entries/pending
 * manager/owner only
 * Query: from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...
 */
router.get("/pending", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const { from, to, userId } = req.query;
    const entries = await listPendingTimeEntries({
      businessId: req.businessId,
      actor: req.user,
      from: from || undefined,
      to: to || undefined,
      userId: userId || undefined,
    });
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/time-entries/summary
 * Query:
 * - mine=true (employee)
 * - userId=... (manager/owner)
 * - from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get("/summary", requireAuth, async (req, res, next) => {
  try {
    const { mine, userId, from, to } = req.query;

    const summary = await getTimeEntrySummary({
      businessId: req.businessId,
      actor: req.user,
      mine: String(mine) === "true",
      userId: userId || undefined,
      from: from || undefined,
      to: to || undefined,
    });

    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/time-entries/bulk/approve
 * manager/owner only
 * Body: { entryIds: string[] }
 */
router.post("/bulk/approve", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const { entryIds } = req.body || {};
    const result = await bulkApproveTimeEntries({
      businessId: req.businessId,
      actor: req.user,
      entryIds,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/time-entries/bulk/reject
 * manager/owner only
 * Body: { entryIds: string[], reason: string }
 */
router.post("/bulk/reject", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const { entryIds, reason } = req.body || {};
    const result = await bulkRejectTimeEntries({
      businessId: req.businessId,
      actor: req.user,
      entryIds,
      reason,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/time-entries
 * Query:
 * - mine=true
 * - userId=... (manager/owner)
 * - from=YYYY-MM-DD
 * - to=YYYY-MM-DD
 * - status=draft|submitted|approved|rejected|void
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { userId, from, to, status, mine } = req.query;

    const entries = await listTimeEntries({
      businessId: req.businessId,
      actor: req.user,
      userId: userId || undefined,
      from: from || undefined,
      to: to || undefined,
      status: status || undefined,
      mine: String(mine) === "true",
    });

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/time-entries
 * Body: { workDate, startTime, endTime, breakMinutes?, notes?, locationId?, targetUserId? }
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { workDate, startTime, endTime, breakMinutes, notes, locationId, targetUserId } = req.body || {};

    const entry = await createManualTimeEntry({
      businessId: req.businessId,
      actor: req.user,
      targetUserId: targetUserId || undefined,
      workDate,
      startTime,
      endTime,
      breakMinutes,
      notes,
      locationId,
    });

    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/time-entries/:id/submit
 */
router.post("/:id/submit", requireAuth, async (req, res, next) => {
  try {
    const entry = await submitTimeEntry({
      businessId: req.businessId,
      actor: req.user,
      entryId: req.params.id,
    });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/time-entries/:id/approve (single)
 */
router.post("/:id/approve", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const entry = await approveTimeEntry({
      businessId: req.businessId,
      actor: req.user,
      entryId: req.params.id,
    });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/time-entries/:id/reject (single)
 * Body: { reason }
 */
router.post("/:id/reject", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const entry = await rejectTimeEntry({
      businessId: req.businessId,
      actor: req.user,
      entryId: req.params.id,
      reason,
    });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/time-entries/:id/void
 */
router.post("/:id/void", requireAuth, async (req, res, next) => {
  try {
    const entry = await voidTimeEntry({
      businessId: req.businessId,
      actor: req.user,
      entryId: req.params.id,
    });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/time-entries/:id
 */
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const { workDate, startTime, endTime, breakMinutes, notes, locationId } = req.body || {};

    const entry = await updateManualTimeEntry({
      businessId: req.businessId,
      actor: req.user,
      entryId: req.params.id,
      workDate,
      startTime,
      endTime,
      breakMinutes,
      notes,
      locationId,
    });

    res.json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/time-entries/:id
 * keep LAST
 */
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const entry = await getTimeEntry({
      businessId: req.businessId,
      actor: req.user,
      entryId: req.params.id,
    });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

export default router;
