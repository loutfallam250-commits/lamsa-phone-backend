const express = require("express");
const Bank = require("../../models/Bank");
const CardFieldSettings = require("../../models/CardFieldSettings");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");

const uploadBankLogo = makeImageUpload();
const router = express.Router();

// GET /api/admin/banks
router.get("/banks", authMiddleware, async (req, res) => {
  try {
    const banks = await Bank.find().sort({ createdAt: -1 });
    res.json(banks);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banks
router.post("/banks", authMiddleware, uploadBankLogo.single("logo"), async (req, res) => {
  try {
    const { name, iban } = req.body;
    if (!name || !iban) return res.status(400).json({ error: "اسم البنك والآيبان مطلوبان" });
    let logo = "";
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "banks");
      logo = result.secure_url;
    }
    const bank = await Bank.create({ name, iban, logo });
    res.status(201).json(bank);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/banks/:id
router.put("/banks/:id", authMiddleware, uploadBankLogo.single("logo"), async (req, res) => {
  try {
    const bank = await Bank.findById(req.params.id);
    if (!bank) return res.status(404).json({ error: "البنك غير موجود" });
    const { name, iban } = req.body;
    if (name) bank.name = name;
    if (iban) bank.iban = iban;
    if (req.file) {
      await deleteFromCloudinary(bank.logo);
      const result = await uploadToCloudinary(req.file.buffer, "banks");
      bank.logo = result.secure_url;
    }
    await bank.save();
    res.json(bank);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banks/:id
router.delete("/banks/:id", authMiddleware, async (req, res) => {
  try {
    const bank = await Bank.findByIdAndDelete(req.params.id);
    if (!bank) return res.status(404).json({ error: "البنك غير موجود" });
    await deleteFromCloudinary(bank.logo);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/card-field-settings
router.get("/card-field-settings", async (req, res) => {
  try {
    let doc = await CardFieldSettings.findOne();
    if (!doc) doc = await CardFieldSettings.create({});
    res.json(doc);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/card-field-settings
router.patch("/card-field-settings", authMiddleware, async (req, res) => {
  try {
    const { field } = req.body;
    if (!["showExpiryDate", "showCvv"].includes(field))
      return res.status(400).json({ error: "حقل غير صحيح" });
    let doc = await CardFieldSettings.findOne();
    if (!doc) doc = await CardFieldSettings.create({});
    doc[field] = !doc[field];
    await doc.save();
    res.json({ [field]: doc[field] });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
