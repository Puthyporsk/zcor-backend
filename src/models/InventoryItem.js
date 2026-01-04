// models/InventoryItem.js
import mongoose from "mongoose";
import tenantScopedPlugin from "../plugins/tenantScoped.js";

const { Schema } = mongoose;

const InventoryItemSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 2000 },

    category: { type: String, trim: true, maxlength: 80 },
    unit: { type: String, trim: true, maxlength: 40, default: "each" }, // each, kg, box, etc.

    // Optional pricing/costing
    cost: { type: Number, min: 0 },  // average/standard cost (optional)
    price: { type: Number, min: 0 }, // selling price (optional)

    reorderPoint: { type: Number, min: 0, default: 0 },

    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },

    // Optional cached stock for quick reads (keep consistent in service layer)
    stockOnHandCached: { type: Number, default: 0 },
    stockUpdatedAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

InventoryItemSchema.plugin(tenantScopedPlugin);
InventoryItemSchema.index({ business: 1, name: 1 });
InventoryItemSchema.index(
  { business: 1, sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: "string" } } }
);

const InventoryItem = mongoose.model("InventoryItem", InventoryItemSchema);
export default InventoryItem;
