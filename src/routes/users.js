import { Router } from "express";
import User from "../models/User.js";
import requireAuth from "../middleware/requireAuth.js";

const router = Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const users = await User.find()
      .byBusiness(req.businessId)
      .notDeleted()
      .select(User.safePublicFields().join(" "))
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    next(err);
  }
});

export default router;