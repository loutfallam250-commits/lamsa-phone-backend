const express = require("express");
const https = require("https");
const router = express.Router();
const PreOrder = require("../models/PreOrder");
const { orderRateLimit } = require("../middlewares/orderRateLimit");
const { authMiddleware } = require("./adminRoutes/middleware");

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: "api.telegram.org", path: `/bot${token}/sendMessage`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => { res.on("data", () => {}); res.on("end", resolve); }
    );
    req.on("error", resolve);
    req.write(body);
    req.end();
  });
}

function validate(req, res, next) {
  const { customerName, phone, productId, productName, price, total } = req.body;
  if (!customerName?.trim()) return res.status(400).json({ ok: false, error: "الاسم مطلوب" });
  if (!phone || !/^(05\d{8}|5\d{8}|\+9665\d{8}|009665\d{8})$/.test(phone.replace(/\s/g, "")))
    return res.status(400).json({ ok: false, error: "رقم الجوال غير صالح" });
  if (!productId) return res.status(400).json({ ok: false, error: "المنتج مطلوب" });
  if (!productName) return res.status(400).json({ ok: false, error: "اسم المنتج مطلوب" });
  if (!price || price <= 0) return res.status(400).json({ ok: false, error: "السعر غير صالح" });
  if (!total || total <= 0) return res.status(400).json({ ok: false, error: "الإجمالي غير صالح" });
  next();
}

// POST /api/pre-orders
router.post("/", orderRateLimit, validate, async (req, res) => {
  try {
    const { customerName, phone, productId, productName, variant, storage, quantity, price, total, paymentMethod, productImage, nationalId } = req.body;
    const reservationId = `PRE-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;

    const preOrder = new PreOrder({
      reservationId, customerName, phone,
      productId, productName, variant, storage,
      quantity: quantity || 1, price, total,
      paymentMethod: paymentMethod || "card",
      paymentStatus: "pending",
      productImage,
    });
    await preOrder.save();

    // Telegram notification
    const deposit = total;
    const remaining = (price ?? 0) - deposit;
    const text = [
      `🏪 طلب لـ متجر مؤسسة البلاد الحديثة للإلكترونيات`,
      `🔢 رقم الطلب: #${reservationId}`,
      ``,
      `📦 المنتج: ${productName}`,
      `🎨 اللون: ${variant || "-"}`,
      `💾 السعة: ${storage || "-"}`,
      ``,
      `💰 سعر المنتج: ${price} SAR`,
      `💳 الدفعة المقدمة: ${deposit} SAR`,
      `💰 المتبقي: ${remaining > 0 ? remaining : "-"} SAR`,
      `──────────────────`,
      ``,
      `👤 اسم العميل: ${customerName}`,
      `📱 واتساب: ${phone}`,
      `🆔 الهوية: ${nationalId || "-"}`,
    ].join("\n");

    await sendTelegramMessage(text).catch(() => {});

    res.status(201).json({ ok: true, reservationId, _id: preOrder._id });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ ok: false, error: "طلب مكرر" });
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

// GET /api/pre-orders (admin)
router.get("/", authMiddleware, async (req, res) => {
  try {
    // [PERF] Add pagination instead of fixed limit
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    
    const [orders, total] = await Promise.all([
      PreOrder.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-__v")
        .lean(),
      PreOrder.countDocuments(),
    ]);
    
    res.json({
      ok: true,
      orders,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});

module.exports = router;
