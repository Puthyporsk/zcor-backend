// models/TimeEntry.js
import mongoose from "mongoose";
import tenantScopedPlugin from "../plugins/tenantScoped.js";

const { Schema } = mongoose;

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:mm
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD (lex sortable)

const BreakSchema = new Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const TimeEntrySchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Keep for future/use (optional)
    location: { type: Schema.Types.ObjectId, ref: "Location" },

    // ✅ New: entry type (manual going forward)
    entryType: {
      type: String,
      enum: ["manual", "clock"],
      default: "manual",
      index: true,
    },

    // ✅ Manual fields (no seconds)
    workDate: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => !v || DATE_REGEX.test(v),
        message: "workDate must be YYYY-MM-DD",
      },
      index: true,
    },
    startTime: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => !v || TIME_REGEX.test(v),
        message: "startTime must be HH:mm",
      },
    },
    endTime: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => !v || TIME_REGEX.test(v),
        message: "endTime must be HH:mm",
      },
    },
    breakMinutes: { type: Number, min: 0, default: 0 },

    // ---- Legacy clock fields (kept only so old docs don't explode) ----
    clockInAt: { type: Date },
    clockOutAt: { type: Date },
    breaks: { type: [BreakSchema], default: [] },

    // Workflow
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected", "void", "open"], // keep "open" for old docs
      default: "draft",
      index: true,
    },
    submittedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },

    notes: { type: String, trim: true, maxlength: 2000 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

TimeEntrySchema.plugin(tenantScopedPlugin);

// ✅ Validation: enforce the manual fields when entryType === "manual"
TimeEntrySchema.pre("validate", function () {
  if (this.entryType === "manual") {
    if (!this.workDate) this.invalidate("workDate", "workDate is required for manual entries");
    if (!this.startTime) this.invalidate("startTime", "startTime is required for manual entries");
    if (!this.endTime) this.invalidate("endTime", "endTime is required for manual entries");
  }

  // Legacy validations for clock (so old docs still validate if saved)
  if (this.entryType === "clock") {
    if (this.clockOutAt && this.clockInAt && this.clockOutAt < this.clockInAt) {
      this.invalidate("clockOutAt", "clockOutAt must be after clockInAt");
    }
    for (const b of this.breaks || []) {
      if (b.endAt && b.endAt < b.startAt) {
        this.invalidate("breaks", "Break endAt must be after startAt");
        break;
      }
    }
  }
});

// Helpful indexes for manual entries
TimeEntrySchema.index({ business: 1, entryType: 1, user: 1, workDate: -1 });
TimeEntrySchema.index({ business: 1, entryType: 1, status: 1, workDate: -1 });

const TimeEntry = mongoose.model("TimeEntry", TimeEntrySchema);
export default TimeEntry;
