const express = require("express");
const Product = require("../../models/Product");
const MainCategory = require("../../models/MainCategory");
const SubCategory = require("../../models/SubCategory");
const SubCategorySettings = require("../../models/SubCategorySettings");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");

const router = express.Router();

let _homeSettingsCache = null;
let _homeSettingsCacheTs = 0;
let _maxCache = null;
let _maxCacheTs = 0;
const SETTINGS_TTL = 5 * 60 * 1000;

function invalidateSettingsCache() {
  _homeSettingsCache = null;
  _maxCache = null;
}

// GET /api/admin/main-categories
router.get("/main-categories", authMiddleware, async (req, res) => {
  try {
    const result = await Product.aggregate([
      { $match: { subCategory: { $ne: null, $exists: true } } },
      { $group: { _id: "$subCategory", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(result.map((r) => ({ name: r._id, count: r.count })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/categories
router.get("/categories", authMiddleware, async (req, res) => {
  try {
    const cats = await Product.distinct("category");
    res.json(cats.filter(Boolean).sort());
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/main-categories
router.post("/main-categories", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "اسم التصنيف مطلوب" });
    const exists = await Product.findOne({ category: name.trim() });
    if (exists) return res.status(400).json({ error: "التصنيف موجود بالفعل" });
    const existsMC = await MainCategory.findOne({ name: name.trim() });
    if (existsMC) return res.status(400).json({ error: "التصنيف موجود بالفعل" });
    const cat = await MainCategory.create({ name: name.trim() });
    res.status(201).json({ name: cat.name, count: 0 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/main-categories/extra
router.get("/main-categories/extra", authMiddleware, async (req, res) => {
  try {
    const [productAgg, manualCats] = await Promise.all([
      Product.aggregate([
        { $match: { subCategory: { $ne: null, $exists: true } } },
        { $group: { _id: "$subCategory", count: { $sum: 1 } } },
      ]),
      MainCategory.find(),
    ]);
    const productMap = new Map(productAgg.map((r) => [r._id, r.count]));
    const allNames = new Set([...productMap.keys(), ...manualCats.map((c) => c.name)]);
    res.json([...allNames].sort().map((name) => ({ name, count: productMap.get(name) || 0 })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/main-categories/rename
router.put("/main-categories/rename", authMiddleware, async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: "الاسم القديم والجديد مطلوبان" });
    const exists = await Product.findOne({ subCategory: newName.trim() });
    if (exists && newName.trim() !== oldName.trim()) return res.status(400).json({ error: "التصنيف موجود بالفعل" });
    await Product.updateMany({ subCategory: oldName }, { $set: { subCategory: newName.trim() } });
    await MainCategory.updateOne({ name: oldName }, { $set: { name: newName.trim() } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/main-categories/remove
router.delete("/main-categories/remove", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "اسم التصنيف مطلوب" });
    await Product.updateMany({ category: name }, { $unset: { category: "" } });
    await MainCategory.deleteOne({ name });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/sub-categories
router.post("/sub-categories", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "اسم التصنيف الفرعي مطلوب" });
    const existsInProducts = await Product.findOne({ subCategory: name.trim() });
    if (existsInProducts) return res.status(400).json({ error: "التصنيف الفرعي موجود بالفعل" });
    const existsSC = await SubCategory.findOne({ name: name.trim() });
    if (existsSC) return res.status(400).json({ error: "التصنيف الفرعي موجود بالفعل" });
    const sc = await SubCategory.create({ name: name.trim() });
    res.status(201).json({ name: sc.name, count: 0 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/all
router.get("/sub-categories/all", authMiddleware, async (req, res) => {
  try {
    const cats = await MainCategory.find().sort({ name: 1 });
    res.json(cats.map((c) => ({ _id: c._id, name: c.name })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/extra
router.get("/sub-categories/extra", authMiddleware, async (req, res) => {
  try {
    const productSubCats = await Product.distinct("subCategory");
    const extra = await SubCategory.find({ name: { $nin: productSubCats.filter(Boolean) } });
    res.json(extra.map((s) => ({ name: s.name, count: 0, _id: s._id })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories
router.get("/sub-categories", authMiddleware, async (req, res) => {
  try {
    const result = await Product.aggregate([
      { $match: { category: { $ne: null, $exists: true } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(result.map((r) => ({ category: r._id, name: r._id, count: r.count })));
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/sub-categories/rename
router.put("/sub-categories/rename", authMiddleware, async (req, res) => {
  try {
    const { oldName, oldCategory, newName, newCategory } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: "الاسم القديم والجديد مطلوبان" });
    await Product.updateMany(
      { subCategory: oldName, category: oldCategory },
      { $set: { subCategory: newName.trim(), category: (newCategory || oldCategory).trim() } }
    );
    await SubCategory.updateOne({ name: oldName }, { $set: { name: newName.trim() } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/sub-categories/remove
router.delete("/sub-categories/remove", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "الاسم مطلوب" });
    await Product.updateMany({ category: name }, { $unset: { category: "" } });
    await SubCategorySettings.deleteMany({ category: name });
    await SubCategory.deleteOne({ name });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/settings
router.get("/sub-categories/settings", authMiddleware, async (req, res) => {
  try {
    const settings = await SubCategorySettings.find();
    res.json(settings);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/sub-categories/settings/toggle
router.patch("/sub-categories/settings/toggle", authMiddleware, async (req, res) => {
  try {
    const { category, subCategory } = req.body;
    if (!category || !subCategory) return res.status(400).json({ error: "البيانات مطلوبة" });
    const existing = await SubCategorySettings.findOne({ category, subCategory });
    const newValue = existing ? !existing.showInHome : true;
    const doc = await SubCategorySettings.findOneAndUpdate(
      { category, subCategory },
      { $set: { showInHome: newValue } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    invalidateSettingsCache();
    res.json({ showInHome: doc.showInHome });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/sub-categories/settings/order
router.patch("/sub-categories/settings/order", authMiddleware, async (req, res) => {
  try {
    const { category, subCategory, order } = req.body;
    if (!category || !subCategory) return res.status(400).json({ error: "البيانات مطلوبة" });
    await SubCategorySettings.findOneAndUpdate(
      { category, subCategory },
      { $set: { order: Number(order) || 0 } },
      { upsert: true }
    );
    invalidateSettingsCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/public
router.get("/sub-categories/public", async (req, res) => {
  try {
    // [PERF] Optimized: single aggregation with lookup for custom images
    const [result, customImages] = await Promise.all([
      Product.aggregate([
        { $match: { category: { $ne: null, $exists: true }, image: { $ne: "", $exists: true } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$category", count: { $sum: 1 }, image: { $first: "$image" } } },
        { $project: { _id: 1, count: 1, image: 1 } },
      ]),
      SubCategorySettings.find({ image: { $ne: "", $exists: true } }).select("category image").lean(),
    ]);
    // [PERF] Use Map for O(1) lookup instead of array.find
    const imageMap = new Map(customImages.map((s) => [s.category, s.image]));
    const response = result.map((r) => ({
      name: r._id,
      count: r.count,
      image: imageMap.get(r._id) || r.image,
    }));
    res.json(response);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/sub-categories/settings/image
router.post("/sub-categories/settings/image", authMiddleware, makeImageUpload().single("image"), async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) return res.status(400).json({ error: "التصنيف مطلوب" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    const existing = await SubCategorySettings.findOne({ category, subCategory: category });
    if (existing?.image) await deleteFromCloudinary(existing.image);
    const result = await uploadToCloudinary(req.file.buffer, "category-images");
    await SubCategorySettings.findOneAndUpdate(
      { category, subCategory: category },
      { $set: { image: result.secure_url } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/home-settings
router.get("/sub-categories/home-settings", async (req, res) => {
  try {
    if (_homeSettingsCache && Date.now() - _homeSettingsCacheTs < SETTINGS_TTL) {
      return res.json(_homeSettingsCache);
    }
    const settings = await SubCategorySettings.find({ category: { $ne: "__config__" } }).sort({ order: 1 }).lean();
    _homeSettingsCache = settings;
    _homeSettingsCacheTs = Date.now();
    res.json(settings);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/sub-categories/max
router.get("/sub-categories/max", async (req, res) => {
  try {
    if (_maxCache !== null && Date.now() - _maxCacheTs < SETTINGS_TTL) {
      return res.json(_maxCache);
    }
    const doc = await SubCategorySettings.findOne({ category: "__config__", subCategory: "__max__" });
    _maxCache = { max: doc ? doc.order : 4 };
    _maxCacheTs = Date.now();
    res.json(_maxCache);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/sub-categories/max
router.patch("/sub-categories/max", authMiddleware, async (req, res) => {
  try {
    const { max } = req.body;
    const val = parseInt(max);
    if (!val || val < 1) return res.status(400).json({ error: "قيمة غير صحيحة" });
    await SubCategorySettings.findOneAndUpdate(
      { category: "__config__", subCategory: "__max__" },
      { $set: { order: val, showInHome: false } },
      { upsert: true }
    );
    _maxCache = null;
    _maxCacheTs = 0;
    res.json({ max: val });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
