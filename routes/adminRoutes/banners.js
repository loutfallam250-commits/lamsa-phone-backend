const express = require("express");
const Banner = require("../../models/Banner");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");

const uploadBanner = makeImageUpload();
const router = express.Router();

const DEFAULT_BANNERS = Array(5).fill(null).map(() => ({ url: "", active: true }));

// GET /api/admin/banners
router.get("/banners", async (req, res) => {
  try {
    let doc = await Banner.findOne();
    if (!doc) doc = await Banner.create({ banners: DEFAULT_BANNERS });
    res.json(doc.banners);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banners/upload/:index
router.post("/banners/upload/:index", authMiddleware, uploadBanner.single("image"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) doc = await Banner.create({ banners: DEFAULT_BANNERS });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    const old = doc.banners[index]?.url;
    await deleteFromCloudinary(old);
    const result = await uploadToCloudinary(req.file.buffer, "banners");
    const url = result.secure_url;
    doc.banners.set(index, { url, active: doc.banners[index].active });
    await doc.save();
    res.json({ url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/banners/toggle/:index
router.patch("/banners/toggle/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) return res.status(404).json({ error: "لا يوجد" });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    const newActive = !doc.banners[index].active;
    doc.banners.set(index, { url: doc.banners[index].url, active: newActive });
    await doc.save();
    res.json({ active: newActive });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banners/add
router.post("/banners/add", authMiddleware, async (req, res) => {
  try {
    let doc = await Banner.findOne();
    if (!doc) doc = await Banner.create({ banners: DEFAULT_BANNERS });
    if (doc.banners.length >= 10) return res.status(400).json({ error: "الحد الأقصى 10 بانرات" });
    doc.banners.push({ url: "", active: true });
    await doc.save();
    res.json({ index: doc.banners.length - 1 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banners/:index/image
router.delete("/banners/:index/image", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    const old = doc.banners[index]?.url;
    await deleteFromCloudinary(old);
    doc.banners.set(index, { url: "", active: doc.banners[index].active });
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banners/:index
router.delete("/banners/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let doc = await Banner.findOne();
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    const old = doc.banners[index]?.url;
    await deleteFromCloudinary(old);
    doc.banners.splice(index, 1);
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
