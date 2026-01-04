// A Business is the tenant boundary. Every User belongs to one Business.
// Scope *all* reads/writes by businessId to enforce tenant isolation.

import mongoose, { model } from "mongoose";
const { Schema } = mongoose;

const AddressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 120 },
    line2: { type: String, trim: true, maxlength: 120 },
    city: { type: String, trim: true, maxlength: 80 },
    province: { type: String, trim: true, maxlength: 80 }, // or state
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, trim: true, maxlength: 80, default: "Canada" },
  },
  { _id: false }
);

const BrandingSchema = new Schema(
  {
    logoUrl: { type: String, trim: true, maxlength: 2048 },
    primaryColor: { type: String, trim: true, maxlength: 32 }, // e.g. "#1A73E8"
  },
  { _id: false }
);

const ModulesSchema = new Schema(
  {
    timeTracking: { type: Boolean, default: true },
    scheduling: { type: Boolean, default: true },
    inventory: { type: Boolean, default: true },
  },
  { _id: false }
);

const SettingsSchema = new Schema(
  {
    timezone: { type: String, trim: true, default: "America/Vancouver" },

    // If you later add strict business rules, keep them here
    timeTracking: {
      roundingMinutes: { type: Number, min: 0, max: 60, default: 0 }, // e.g. 15
      requireClockOutNoteAfterHours: { type: Boolean, default: false },
    },

    scheduling: {
      weekStartsOn: { type: Number, min: 0, max: 6, default: 1 }, // 1=Mon
      minShiftMinutes: { type: Number, min: 0, default: 0 },
    },

    inventory: {
      lowStockThresholdDefault: { type: Number, min: 0, default: 0 },
      trackCost: { type: Boolean, default: false },
    },
  },
  { _id: false }
);

const BusinessSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    // Short URL-friendly identifier; useful for routing, invites, etc.
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },

    status: {
      type: String,
      enum: ["active", "trial", "suspended", "deleted"],
      default: "trial",
      index: true,
    },

    // Ownership / audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" }, // typically owner user
    deletedAt: { type: Date },

    // Contact info
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 320 },
    contactPhone: { type: String, trim: true, maxlength: 40 },
    address: AddressSchema,

    // Optional: industry/category for analytics and future UX
    industry: { type: String, trim: true, maxlength: 80 },

    // Feature toggles for the tenant
    modules: { type: ModulesSchema, default: () => ({}) },

    // Tenant-wide config
    settings: { type: SettingsSchema, default: () => ({}) },

    // Visual branding
    branding: { type: BrandingSchema, default: () => ({}) },

    // Subscription placeholder (you can integrate Stripe later)
    subscription: {
      plan: {
        type: String,
        enum: ["free", "starter", "pro", "enterprise"],
        default: "starter",
      },
      renewalAt: { type: Date },
      customerId: { type: String, trim: true }, // e.g. Stripe customer id
    },
  },
  {
    timestamps: true,
  }
);

// ---- Indexes ----
BusinessSchema.index({ slug: 1 }, { unique: true });
BusinessSchema.index({ name: "text", slug: "text" });

// ---- Middleware ----
BusinessSchema.pre("save", function preSave(next) {
  // Soft-delete convenience
  if (this.status === "deleted" && !this.deletedAt) {
    this.deletedAt = new Date();
  }
  next();
});

// ---- Helpers ----
BusinessSchema.methods.isActive = function isActive() {
  return this.status === "active" || this.status === "trial";
};

export default model("Business", BusinessSchema);
