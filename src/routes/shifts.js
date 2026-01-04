// src/routes/shifts.js
import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import requireRole from "../middleware/requireRole.js";
import {
  createShift,
  updateShift,
  publishShift,
  cancelShift,
  assignShift,
  unassignShift,
  getShift,
  listShifts,
} from "../services/shiftService.js";

const router = Router();

/**
 * GET /api/shifts
 * Query:
 * - from, to (ISO)
 * - userId (manager/owner)
 * - status=draft|published|canceled (manager/owner)
 * - mine=true (manager/owner)
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { from, to, userId, status, mine, includeOpen } = req.query;

    const shifts = await listShifts({
      businessId: req.businessId,
      actor: req.user,
      from: from || undefined,
      to: to || undefined,
      userId: userId || undefined,
      status: status || undefined,
      mine: String(mine) === "true",
      includeOpen: includeOpen === undefined ? true : String(includeOpen) === "true",
    });

    res.json(shifts);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shifts
 * manager/owner only
 * Body: { userId?, locationId?, startAt, endAt, roleTag?, notes? }
 */
router.post("/", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const { userId, locationId, startAt, endAt, roleTag, notes } = req.body || {};

    const shift = await createShift({
      businessId: req.businessId,
      actor: req.user,
      userId: userId ?? null,
      locationId: locationId ?? null,
      startAt,
      endAt,
      roleTag,
      notes,
    });

    res.status(201).json(shift);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/shifts/:id
 * manager/owner only
 */
router.patch("/:id", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const { userId, locationId, startAt, endAt, roleTag, notes } = req.body || {};

    const shift = await updateShift({
      businessId: req.businessId,
      actor: req.user,
      shiftId: req.params.id,
      userId,
      locationId,
      startAt,
      endAt,
      roleTag,
      notes,
    });

    res.json(shift);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shifts/:id/publish
 * manager/owner only
 */
router.post("/:id/publish", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const shift = await publishShift({
      businessId: req.businessId,
      actor: req.user,
      shiftId: req.params.id,
    });
    res.json(shift);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shifts/:id/cancel
 * manager/owner only
 */
router.post("/:id/cancel", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const shift = await cancelShift({
      businessId: req.businessId,
      actor: req.user,
      shiftId: req.params.id,
    });
    res.json(shift);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shifts/:id/assign
 * manager/owner only
 * Body: { userId }
 */
router.post("/:id/assign", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const { userId } = req.body || {};
    const shift = await assignShift({
      businessId: req.businessId,
      actor: req.user,
      shiftId: req.params.id,
      userId,
    });
    res.json(shift);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shifts/:id/unassign
 * manager/owner only
 */
router.post("/:id/unassign", requireAuth, requireRole("manager", "owner"), async (req, res, next) => {
  try {
    const shift = await unassignShift({
      businessId: req.businessId,
      actor: req.user,
      shiftId: req.params.id,
    });
    res.json(shift);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shifts/:id
 */
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const shift = await getShift({
      businessId: req.businessId,
      actor: req.user,
      shiftId: req.params.id,
    });
    res.json(shift);
  } catch (err) {
    next(err);
  }
});

export default router;
