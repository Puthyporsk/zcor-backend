// routes/auth.js
import { Router } from "express";
import slugify from "slugify";
import User from "../models/User.js";
import Business from "../models/Business.js";
import requireAuth from "../middleware/requireAuth.js";
import { signAccessToken } from "../utils/jwt.js";
import { badRequest, conflict, unauthorized } from "../utils/httpError.js";

const router = Router();
const COOKIE_NAME = process.env.COOKIE_NAME || "auth_token";

/**
 * Cookie options:
 * - httpOnly: JS can't read the token
 * - sameSite: "lax" works well for localhost + most normal navigation
 * - secure: only true in production (https)
 */
function cookieBaseOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

function setAuthCookie(res, token, remember = false) {
  // If remember = true => persist cookie longer; else session cookie
  const opts = cookieBaseOptions();

  if (remember) {
    // 30 days
    opts.maxAge = 30 * 24 * 60 * 60 * 1000;
  }
  // if not remember: no maxAge => session cookie

  res.cookie(COOKIE_NAME, token, opts);
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieBaseOptions());
}

function userResponse(user) {
  // your User schema already strips sensitive fields in toJSON, but keep explicit:
  return {
    _id: user._id,
    business: user.business,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * POST /api/auth/register
 * Body: { businessName, firstName, lastName, displayName?, email, password }
 * Creates Business + Owner user, returns token.
 */
router.post("/register", async (req, res, next) => {
  try {
    const { businessName, firstName, lastName, displayName, email, password, remember } =
      req.body || {};

    if (!businessName || String(businessName).trim().length < 2) {
      throw badRequest("businessName is required");
    }
    if (!email) throw badRequest("email is required");
    if (!password || String(password).length < 8) {
      throw badRequest("password must be at least 8 characters");
    }

    const baseSlug = slugify(String(businessName), { lower: true, strict: true });
    if (!baseSlug) throw badRequest("Invalid businessName");

    let slug = baseSlug;
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await Business.findOne({ slug }).select("_id").lean();
      if (!exists) break;
      slug = `${baseSlug}-${Math.floor(Math.random() * 9000 + 1000)}`;
    }

    const business = await Business.create({
      name: String(businessName).trim(),
      slug,
      status: "trial",
    });

    const existing = await User.findOne({
      business: business._id,
      email: String(email).toLowerCase().trim(),
    })
      .select("_id")
      .lean();

    if (existing) throw conflict("Email is already registered in this business");

    const owner = await User.create({
      business: business._id,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      displayName: displayName || undefined,
      email: String(email).toLowerCase().trim(),
      role: "owner",
      status: "active",
      password,
    });

    business.createdBy = owner._id;
    await business.save();

    const token = signAccessToken(owner);
    setAuthCookie(res, token, Boolean(remember));

    res.status(201).json({
      business: {
        _id: business._id,
        name: business.name,
        slug: business.slug,
        status: business.status,
      },
      user: userResponse(owner),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password, businessSlug? }
 *
 * If you later support multiple businesses per email, require businessSlug.
 * For now: we find the user by email across businesses; if multiple, we error.
 */
/**
 * POST /api/auth/login
 * Body: { email, password, businessSlug?, remember? }
 * Sets HttpOnly cookie, returns { user }
 */
router.post("/login", async (req, res, next) => {
  try {
    const { email, password, businessSlug, remember } = req.body || {};
    if (!email || !password) throw badRequest("email and password are required");

    const emailNorm = String(email).toLowerCase().trim();

    let business = null;
    if (businessSlug) {
      business = await Business.findOne({
        slug: String(businessSlug).toLowerCase().trim(),
      }).select("_id name slug status");
      if (!business) throw unauthorized("Invalid credentials");
    }

    const q = business ? { business: business._id, email: emailNorm } : { email: emailNorm };

    const users = await User.find(q).select(
      "+passwordHash business role status email firstName lastName displayName",
    );

    if (!users || users.length === 0) throw unauthorized("Invalid credentials");
    if (!business && users.length > 1) {
      throw badRequest("Multiple businesses found for this email. Provide businessSlug.");
    }

    const user = users[0];

    const ok = await user.comparePassword(password);
    if (!ok) throw unauthorized("Invalid credentials");

    if (user.status === "disabled" || user.status === "deleted") {
      throw unauthorized("Account is not active");
    }

    await user.markLogin();

    const token = signAccessToken(user, Boolean(remember));
    setAuthCookie(res, token, Boolean(remember));

    // Don't return token to JS
    res.json({ user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Clears cookie
 */
router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ message: "Logged out" });
});

/**
 * GET /api/auth/me (protected)
 */
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: userResponse(req.user) });
});

/**
 * POST /api/auth/forgot-password
 * Body: { email, businessSlug? }
 * Always returns 200 so attackers can’t enumerate emails.
 * In development, returns resetToken for testing.
 */
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email, businessSlug } = req.body || {};
    if (!email) throw badRequest("email is required");

    const emailNorm = String(email).toLowerCase().trim();

    let business = null;
    if (businessSlug) {
      business = await Business.findOne({ slug: String(businessSlug).toLowerCase().trim() }).select("_id").lean();
    }

    const q = business ? { business: business._id, email: emailNorm } : { email: emailNorm };

    // Need tokenHash field (select:false) => explicitly select it
    const users = await User.find(q).select("+passwordReset.tokenHash +passwordReset.expiresAt").limit(2);
    const user = users?.length === 1 ? users[0] : null;

    let resetToken = null;
    if (user) {
      resetToken = user.createPasswordResetToken(30);
      await user.save();
      // TODO: send email with resetToken
    }

    const payload = { message: "If the account exists, password reset instructions were sent." };
    if (process.env.NODE_ENV !== "production" && resetToken) {
      payload.resetToken = resetToken; // dev-only convenience
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reset-password
 * Body: { email, token, newPassword, businessSlug? }
 */
router.post("/reset-password", async (req, res, next) => {
  try {
    const { email, token, newPassword, businessSlug } = req.body || {};
    if (!email || !token || !newPassword) throw badRequest("email, token, newPassword are required");
    if (String(newPassword).length < 8) throw badRequest("newPassword must be at least 8 characters");

    const emailNorm = String(email).toLowerCase().trim();

    let business = null;
    if (businessSlug) {
      business = await Business.findOne({ slug: String(businessSlug).toLowerCase().trim() }).select("_id").lean();
      if (!business) throw badRequest("Invalid businessSlug");
    }

    const q = business ? { business: business._id, email: emailNorm } : { email: emailNorm };

    const users = await User.find(q)
      .select("+passwordReset.tokenHash +passwordReset.expiresAt +passwordHash")
      .limit(2);

    if (!users || users.length !== 1) throw badRequest("Invalid reset token");

    const user = users[0];

    const ok = user.consumePasswordResetToken(String(token));
    if (!ok) throw badRequest("Invalid reset token");

    user.password = String(newPassword);
    user.status = user.status === "invited" ? "active" : user.status;
    await user.save();

    res.json({ message: "Password has been reset successfully." });
  } catch (err) {
    next(err);
  }
});

export default router;
