const express = require("express");
const Checkout = require("../../models/Checkout");
const { authMiddleware } = require("./middleware");

const router = express.Router();

// GET /api/admin/orders?page=1&limit=10&search=
router.get("/orders", authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 10);
    const search = (req.query.search || "").trim();

    const filter = search
      ? {
          $or: [
            { customer: { $regex: search, $options: "i" } },
            { whatsapp: { $regex: search, $options: "i" } },
            { orderId: { $regex: search, $options: "i" } },
            { nationalId: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const [orders, total] = await Promise.all([
      Checkout.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Checkout.countDocuments(filter),
    ]);

    res.json({ orders, total, page, pages: Math.ceil(total / limit) });
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

// GET /api/admin/orders/:id
router.get("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Checkout.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/orders/:id  (status or financials)
router.put("/orders/:id", authMiddleware, async (req, res) => {
  try {
    let update;
    if (req.body.financials) {
      const { total, downPayment, months, monthlyPayment } = req.body;
      update = { total, downPayment, months, monthlyPayment };
    } else {
      const VALID_STATUSES = ["pending", "confirmed", "cancelled"];
      if (!VALID_STATUSES.includes(req.body.status))
        return res.status(400).json({ ok: false, error: "حالة غير صحيحة" });
      update = { status: req.body.status };
    }
    const order = await Checkout.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/orders/:id
router.delete("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Checkout.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

module.exports = router;
