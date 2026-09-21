const express = require("express");
const Checkout = require("../../models/Checkout");
const { authMiddleware } = require("./middleware");

const router = express.Router();

// Fields shown in the orders list table — no card data, no full item details
const LIST_PROJECTION = {
  orderId: 1,
  customer: 1,
  whatsapp: 1,
  installmentType: 1,
  months: 1,
  total: 1,
  downPayment: 1,
  status: 1,
  createdAt: 1,
  // items kept minimal — only name shown in list (for search relevance display)
  "items.name": 1,
};

// GET /api/admin/orders?page=1&limit=10&search=&status=
router.get("/orders", authMiddleware, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 10);
    const skip  = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const status = req.query.status || "";

    // Build filter
    const filter = {};

    if (status && ["pending", "confirmed", "cancelled"].includes(status)) {
      filter.status = status;
    }

    if (search) {
      // Use MongoDB text index for efficient full-text search across customer,
      // whatsapp, orderId, nationalId — avoids full collection scan from $regex.
      // The text index was added in models/Checkout.js with default_language:"none"
      // so Arabic/numeric content is indexed as-is without stemming.
      filter.$text = { $search: search };
    }

    // Run find + count in parallel — count is skipped on page 1 with no search/filter
    // to avoid a full-collection count on the most common case.
    const needsCount = page === 1 || search || status;

    // When using $text search, sort by relevance score first; otherwise by date.
    const sortOrder = search
      ? { score: { $meta: "textScore" }, createdAt: -1 }
      : { createdAt: -1 };

    const [orders, total] = await Promise.all([
      Checkout.find(filter, search ? { score: { $meta: "textScore" } } : {})
        .sort(sortOrder)
        .skip(skip)
        .limit(limit)
        .select(LIST_PROJECTION)
        .lean(),
      needsCount
        ? Checkout.countDocuments(filter)
        : Promise.resolve(-1), // sentinel — frontend keeps its cached total
    ]);

    const resolvedTotal = total === -1
      ? undefined   // frontend must keep previous total
      : total;

    res.json({
      orders,
      ...(resolvedTotal !== undefined && { total: resolvedTotal, pages: Math.ceil(resolvedTotal / limit) }),
      page,
    });
  } catch (err) {
    console.error("GET /orders error:", err);
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

// GET /api/admin/orders/:id — full detail, including card fields
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
    // Return only the updated fields instead of the full document
    const order = await Checkout.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, select: "_id status total downPayment months monthlyPayment updatedAt" }
    );
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json(order);
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/orders/:id
router.delete("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Checkout.findByIdAndDelete(req.params.id).select("_id");
    if (!order) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

module.exports = router;
