const mongoose = require("mongoose");

const preOrderSchema = new mongoose.Schema(
  {
    reservationId: { type: String, required: true, unique: true },
    orderType: { type: String, default: "PRE_ORDER", immutable: true },
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    city: { type: String },
    address: { type: String },
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    variant: { type: String },
    storage: { type: String },
    quantity: { type: Number, default: 1 },
    price: { type: Number, required: true },
    total: { type: Number, required: true },
    paymentMethod: { type: String, default: "card" },
    paymentStatus: { type: String, enum: ["pending", "confirmed"], default: "pending" },
    status: { type: String, enum: ["pending", "confirmed", "cancelled"], default: "pending" },
    reservationDate: { type: Date, default: Date.now },
    productImage: { type: String },
  },
  { timestamps: true }
);

preOrderSchema.index({ createdAt: -1 });
preOrderSchema.index({ phone: 1 });
preOrderSchema.index({ reservationId: 1 }); // [PERF] Add index for reservationId lookups
preOrderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PreOrder", preOrderSchema);
