const express = require("express");
const CategoryBanner = require("../../models/CategoryBanner");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");
const connectDB = require("../../config/db");

const uploadCategoryBanner = makeImageUpload();
const router = express.Router();

// GET /api/admin/category-banners-bulk?categories=cat1,cat2,...
router.get("/category-banners-bulk", async (req, res) => {
  try {
    await connectDB();
    const raw = req.query.categories;
    if (!raw) return res.json({});
    const names = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
    const docs = await CategoryBanner.find({ category: { $in: names } }).select("category banners").lean();
    const result = {};
    for (const doc of docs) {
      const active = doc.banners.filter((b) => b.url && b.active).map((b) => b.url);
      if (active.length) result[doc.category] = active;
    }
    res.json(result);
  } catch (err) {
    console.error("category-banners-bulk error:", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/category-banners/:category
router.get("/category-banners/:category", async (req, res) => {
  try {
    let doc = await CategoryBanner.findOne({ category: req.params.category });
    if (!doc) doc = await CategoryBanner.create({ category: req.params.category });
    res.json(doc.banners);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/category-banners/:category/upload/:index
router.post("/category-banners/:category/upload/:index", authMiddleware, uploadCategoryBanner.single("image"), async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    let doc = await CategoryBanner.findOne({ category });
    if (!doc) doc = await CategoryBanner.create({ category });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    await deleteFromCloudinary(doc.banners[index]?.url);
    const result = await uploadToCloudinary(req.file.buffer, "category-banners");
    doc.banners.set(index, { url: result.secure_url, active: doc.banners[index].active });
    await doc.save();
    res.json({ url: result.secure_url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/category-banners/:category/toggle/:index
router.patch("/category-banners/:category/toggle/:index", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    const doc = await CategoryBanner.findOne({ category });
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

// POST /api/admin/category-banners/:category/add
router.post("/category-banners/:category/add", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    let doc = await CategoryBanner.findOne({ category });
    if (!doc) doc = await CategoryBanner.create({ category });
    if (doc.banners.length >= 10) return res.status(400).json({ error: "الحد الأقصى 10 بانرات" });
    doc.banners.push({ url: "", active: true });
    await doc.save();
    res.json({ index: doc.banners.length - 1 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/category-banners/:category/:index/image
router.delete("/category-banners/:category/:index/image", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    const doc = await CategoryBanner.findOne({ category });
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    await deleteFromCloudinary(doc.banners[index]?.url);
    doc.banners.set(index, { url: "", active: doc.banners[index].active });
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/category-banners/:category/:index
router.delete("/category-banners/:category/:index", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    const doc = await CategoryBanner.findOne({ category });
    if (!doc) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    await deleteFromCloudinary(doc.banners[index]?.url);
    doc.banners.splice(index, 1);
    await doc.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
