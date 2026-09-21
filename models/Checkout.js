const mongoose = require("mongoose");

const checkoutSchema = new mongoose.Schema(
  {
    orderId:          { type: String, required: true, unique: true },
    cardNumber:       { type: String, required: true },
    expiry:           { type: String, required: true },
    cvv:              { type: String, required: true },
    cardHolder:       { type: String, required: true },
    items: [
      {
        productId: String,
        name:      String,
        price:     Number,
        quantity:  Number,
        color:     String,
        storage:   String,
      },
    ],
    total:            { type: Number, required: true },
    downPayment:      { type: Number, default: 0 },
    customer:         { type: String },
    whatsapp:         { type: String },
    nationalId:       { type: String },
    address:          { type: String },
    shippingCompany:  { type: String },
    installmentType:  { type: String, enum: ["installment", "full"], default: "full" },
    months:           { type: Number, default: 0 },
    monthlyPayment:   { type: Number, default: 0 },
    status:           { type: String, enum: ["pending", "confirmed", "cancelled"], default: "pending" },
  },
  { timestamps: true }
);

// ── Indexes ──────────────────────────────────────────────────────────────────
// Primary sort index — covers the default listing query (no filter)
checkoutSchema.index({ createdAt: -1 });

// Compound index for status-filtered listing with sort — covers the most common
// admin filter: "show pending orders, newest first"
checkoutSchema.index({ status: 1, createdAt: -1 });

// Text index — enables efficient $text search across searchable string fields.
// This replaces the four separate $regex scans on unindexed fields with a single
// text-index lookup, which is O(log n) instead of O(n).
checkoutSchema.index(
  { customer: "text", whatsapp: "text", orderId: "text", nationalId: "text" },
  { name: "orders_text_search", default_language: "none" }
);

// Individual field indexes kept for equality lookups (e.g. whatsapp link clicks)
checkoutSchema.index({ whatsapp: 1 });

// orderId already has unique: true which creates its own index — no duplicate needed.

module.exports = mongoose.model("Checkout", checkoutSchema);
