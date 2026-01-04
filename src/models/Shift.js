// models/Shift.js
import mongoose from "mongoose";
import tenantScopedPlugin from "../plugins/tenantScoped.js";

const { Schema } = mongoose;

const ShiftSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },

    // If null, it’s an open/unassigned shift
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },

    location: { type: Schema.Types.ObjectId, ref: "Location" },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },

    roleTag: { type: String, trim: true, maxlength: 80 }, // e.g. "Cashier", "Cook"
    notes: { type: String, trim: true, maxlength: 2000 },

    status: {
      type: String,
      enum: ["draft", "published", "canceled"],
      default: "draft",
      index: true,
    },

    publishedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

ShiftSchema.plugin(tenantScopedPlugin);

ShiftSchema.pre("validate", function () {
  if (this.endAt && this.startAt && this.endAt <= this.startAt) {
    this.invalidate("endAt", "endAt must be after startAt");
  }
});

ShiftSchema.index({ business: 1, startAt: -1 });
ShiftSchema.index({ business: 1, user: 1, startAt: -1 });
ShiftSchema.index({ business: 1, status: 1, startAt: -1 });

const Shift = mongoose.model("Shift", ShiftSchema);
export default Shift;
