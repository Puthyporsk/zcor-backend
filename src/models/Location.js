// models/Location.js
import mongoose from "mongoose";
import tenantScopedPlugin from "../plugins/tenantScoped.js";

const { Schema } = mongoose;

const AddressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 120 },
    line2: { type: String, trim: true, maxlength: 120 },
    city: { type: String, trim: true, maxlength: 80 },
    province: { type: String, trim: true, maxlength: 80 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, trim: true, maxlength: 80 },
  },
  { _id: false }
);

const LocationSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    address: AddressSchema,

    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

LocationSchema.plugin(tenantScopedPlugin);
LocationSchema.index({ business: 1, name: 1 }, { unique: true });

const Location = mongoose.model("Location", LocationSchema);
export default Location;
