// Assumptions:
// - Multi-tenant: every user belongs to exactly one Business (tenant).
// - Roles: owner / manager / employee.
// - Auth: local email+password today; extensible to OAuth providers later.
//
// Usage:
//   const User = require("./models/User");
//   const u = await User.create({ business, email, role, firstName, lastName, password: "secret123" });

import mongoose, { model } from "mongoose";
import { hash as _hash, compare } from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import tenantScopedPlugin from "../plugins/tenantScoped.js";

const { Schema } = mongoose;

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const WeeklyAvailabilitySchema = new Schema(
  {
    // 0 = Sunday, 6 = Saturday
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    ranges: [
      {
        // "HH:mm" 24h format; keep as string for simplicity
        start: { type: String, required: true }, // e.g. "09:00"
        end: { type: String, required: true }, // e.g. "17:00"
      },
    ],
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    // Multi-tenant boundary
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },

    // Identity / profile
    firstName: { type: String, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80 },
    displayName: { type: String, trim: true, maxlength: 160 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 320,
      validate: {
        validator: (v) => EMAIL_REGEX.test(v),
        message: "Invalid email format",
      },
    },
    phone: { type: String, trim: true, maxlength: 40 },
    avatarUrl: { type: String, trim: true, maxlength: 2048 },

    // Authorization
    role: {
      type: String,
      enum: ["owner", "manager", "employee"],
      default: "employee",
      required: true,
      index: true,
    },
    // Optional fine-grained permissions
    permissions: [{ type: String, trim: true }],

    // Account status lifecycle
    status: {
      type: String,
      enum: ["active", "invited", "disabled", "deleted"],
      default: "active",
      index: true,
    },

    // Authentication (local)
    passwordHash: { type: String, select: false },
    passwordChangedAt: { type: Date },
    isEmailVerified: { type: Boolean, default: false },

    // For OAuth / SSO later (optional)
    authProviders: [
      {
        provider: {
          type: String,
          enum: ["google", "github", "microsoft", "okta", "local"],
          default: "local",
        },
        providerUserId: { type: String, trim: true },
      },
    ],

    // Tokens (store hashes, never raw tokens)
    passwordReset: {
      tokenHash: { type: String, select: false },
      expiresAt: { type: Date },
    },
    emailVerification: {
      tokenHash: { type: String, select: false },
      expiresAt: { type: Date },
    },

    // Employee/work metadata (use what you need; safe to keep optional)
    employeeMeta: {
      employeeCode: { type: String, trim: true, maxlength: 50 }, // e.g. internal ID
      jobTitle: { type: String, trim: true, maxlength: 120 },
      payType: { type: String, enum: ["hourly", "salary"], default: "hourly" },
      hourlyRate: { type: Number, min: 0 },
      startDate: { type: Date },
      notes: { type: String, trim: true, maxlength: 2000 },
      emergencyContact: {
        name: { type: String, trim: true, maxlength: 120 },
        phone: { type: String, trim: true, maxlength: 40 },
        relationship: { type: String, trim: true, maxlength: 80 },
      },
    },

    // Scheduling support (optional)
    availability: {
      weekly: [WeeklyAvailabilitySchema],
      // If you later want time-off blocks, add:
      // timeOff: [{ start: Date, end: Date, reason: String }]
    },

    // Preferences (optional)
    preferences: {
      timezone: { type: String, trim: true, default: "America/Vancouver" },
      weekStartsOn: { type: Number, min: 0, max: 6, default: 1 }, // 1 = Monday
      notifications: {
        email: { type: Boolean, default: true },
      },
    },

    // Audit / activity
    lastLoginAt: { type: Date },
    lastSeenAt: { type: Date },

    // Soft delete (keeps data for audit/history)
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        // Remove sensitive fields & internal fields when sending to client
        delete ret.passwordHash;
        delete ret.passwordReset;
        delete ret.emailVerification;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.passwordReset;
        delete ret.emailVerification;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// --- Indexes ---
// Ensure email uniqueness *within a business tenant*
UserSchema.index({ business: 1, email: 1 }, { unique: true });
// Helpful for common filtering
UserSchema.index({ business: 1, role: 1, status: 1 });

// --- Virtual password setter (not persisted) ---
UserSchema.virtual("password").set(function setPassword(pw) {
  this._password = pw;
});

// --- Middleware: hash password when provided ---
UserSchema.pre("save", async function preSave(next) {
  try {
    // Soft-delete convenience
    if (this.status === "deleted" && !this.deletedAt) {
      this.deletedAt = new Date();
    }

    if (this._password) {
      const saltRounds = 12;
      const hash = await _hash(this._password, saltRounds);
      this.passwordHash = hash;
      this.passwordChangedAt = new Date();
      this._password = undefined;
    }
    next();
  } catch (err) {
    next(err);
  }
});

// --- Instance methods ---
UserSchema.methods.comparePassword = async function comparePassword(plain) {
  if (!this.passwordHash) return false;
  return compare(plain, this.passwordHash);
};

UserSchema.methods.markLogin = async function markLogin() {
  this.lastLoginAt = new Date();
  this.lastSeenAt = new Date();
  return this.save();
};

// Create a reset token; return the *raw* token (send via email), store only the hash.
UserSchema.methods.createPasswordResetToken = function createPasswordResetToken(
  ttlMinutes = 30
) {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  this.passwordReset = {
    tokenHash,
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  };
  return raw;
};

UserSchema.methods.createEmailVerificationToken = function createEmailVerificationToken(
  ttlMinutes = 60 * 24
) {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  this.emailVerification = {
    tokenHash,
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  };
  return raw;
};

UserSchema.methods.verifyEmailWithToken = function verifyEmailWithToken(rawToken) {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const ev = this.emailVerification;

  if (!ev?.tokenHash || !ev?.expiresAt) return false;
  if (ev.expiresAt.getTime() < Date.now()) return false;
  if (ev.tokenHash !== tokenHash) return false;

  this.isEmailVerified = true;
  this.emailVerification = undefined;
  return true;
};

UserSchema.methods.consumePasswordResetToken = function consumePasswordResetToken(rawToken) {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const pr = this.passwordReset;

  if (!pr?.tokenHash || !pr?.expiresAt) return false;
  if (pr.expiresAt.getTime() < Date.now()) return false;
  if (pr.tokenHash !== tokenHash) return false;

  // token is valid; consume it
  this.passwordReset = undefined;
  return true;
};

// --- Static helpers ---
UserSchema.statics.safePublicFields = function safePublicFields() {
  return [
    "_id",
    "business",
    "firstName",
    "lastName",
    "displayName",
    "email",
    "phone",
    "avatarUrl",
    "role",
    "permissions",
    "status",
    "isEmailVerified",
    "employeeMeta",
    "availability",
    "preferences",
    "lastLoginAt",
    "lastSeenAt",
    "createdAt",
    "updatedAt",
  ];
};

UserSchema.plugin(tenantScopedPlugin);

export default model("User", UserSchema);
