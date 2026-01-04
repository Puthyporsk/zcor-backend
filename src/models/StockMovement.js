// models/StockMovement.js
import mongoose from "mongoose";
import tenantScopedPlugin from "../plugins/tenantScoped.js";

const { Schema } = mongoose;

const StockMovementSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },

    item: { type: Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },

    // Optional location support
    location: { type: Schema.Types.ObjectId, ref: "Location", index: true },

    type: {
      type: String,
      enum: ["receive", "adjust", "use", "sale", "return", "transfer_in", "transfer_out"],
      required: true,
      index: true,
    },

    // Use a signed delta: + adds stock, - removes stock
    quantityDelta: { type: Number, required: true },

    // Optional costing for receives/adjustments
    unitCost: { type: Number, min: 0 },

    reason: { type: String, trim: true, maxlength: 200 }, // e.g. "Damaged", "Cycle count"
    note: { type: String, trim: true, maxlength: 2000 },

    // Link to another doc if needed later (e.g. purchase order, sale, etc.)
    reference: {
      kind: { type: String, trim: true, maxlength: 60 }, // "PurchaseOrder", "TimeEntry", etc.
      id: { type: Schema.Types.ObjectId },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

StockMovementSchema.plugin(tenantScopedPlugin);

StockMovementSchema.pre("validate", function () {
  if (typeof this.quantityDelta === "number" && this.quantityDelta === 0) {
    this.invalidate("quantityDelta", "quantityDelta cannot be 0");
  }
});

StockMovementSchema.index({ business: 1, item: 1, createdAt: -1 });
StockMovementSchema.index({ business: 1, location: 1, createdAt: -1 });

const StockMovement = mongoose.model("StockMovement", StockMovementSchema);
export default StockMovement;
