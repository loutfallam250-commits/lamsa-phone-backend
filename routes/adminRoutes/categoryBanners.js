const express = require("express");
const CategoryBanner = require("../../models/CategoryBanner");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");

const uploadCategoryBanner = makeImageUpload();
const router = express.Router();

/** Ensure a CategoryBanner doc exists for the given category — single round-trip, race-safe */
async function ensureCategoryDoc(category) {
  return CategoryBanner.findOneAndUpdate(
    { category },
    { $setOnInsert: { category, banners: [{ url: "", active: true }] } },
    { upsert: true, new: true }
  );
}

// GET /api/admin/category-banners-bulk?categories=cat1,cat2,...
// Public endpoint — no auth needed, used by storefront
router.get("/category-banners-bulk", async (req, res) => {
  try {
    const raw = req.query.categories;
    if (!raw) return res.json({});
    const names = String(raw).split(",").map((s) => s.trim()).filter(Boolean);

    // Single query, index hit on category, lean for minimal memory
    const docs = await CategoryBanner.find(
      { category: { $in: names } },
      "category banners"
    ).lean();

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
    const doc = await ensureCategoryDoc(req.params.category);
    res.json(doc.banners);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/category-banners/:category/upload/:index
router.post(
  "/category-banners/:category/upload/:index",
  authMiddleware,
  uploadCategoryBanner.single("image"),
  async (req, res) => {
    try {
      const { category } = req.params;
      const index = parseInt(req.params.index);
      if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });
      if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });

      // Fetch only the affected banner element to get the old URL
      const doc = await CategoryBanner.findOne({ category }, `banners.${index}`).lean();
      if (!doc || index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

      await deleteFromCloudinary(doc.banners[index]?.url);
      const result = await uploadToCloudinary(req.file.buffer, "category-banners");
      const url = result.secure_url;

      // Targeted $set — only touch the one field that changed
      await CategoryBanner.updateOne(
        { category },
        { $set: { [`banners.${index}.url`]: url } }
      );

      res.json({ url });
    } catch {
      res.status(500).json({ error: "خطأ في الخادم" });
    }
  }
);

// PATCH /api/admin/category-banners/:category/toggle/:index
router.patch("/category-banners/:category/toggle/:index", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    // Fetch only the single banner element we need
    const doc = await CategoryBanner.findOne({ category }, `banners.${index}`).lean();
    if (!doc) return res.status(404).json({ error: "لا يوجد" });
    if (index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    const newActive = !doc.banners[index].active;

    await CategoryBanner.updateOne(
      { category },
      { $set: { [`banners.${index}.active`]: newActive } }
    );

    res.json({ active: newActive });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/category-banners/:category/add
router.post("/category-banners/:category/add", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const doc = await ensureCategoryDoc(category);
    if (doc.banners.length >= 10) return res.status(400).json({ error: "الحد الأقصى 10 بانرات" });

    // Atomic $push — no full-doc save
    await CategoryBanner.updateOne(
      { category },
      { $push: { banners: { url: "", active: true } } }
    );

    res.json({ index: doc.banners.length }); // new index = old length
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/category-banners/:category/:index/image
router.delete("/category-banners/:category/:index/image", authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    const doc = await CategoryBanner.findOne({ category }, `banners.${index}`).lean();
    if (!doc) return res.json({ success: true });
    if (index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    await deleteFromCloudinary(doc.banners[index]?.url);
    await CategoryBanner.updateOne(
      { category },
      { $set: { [`banners.${index}.url`]: "" } }
    );

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
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    const doc = await CategoryBanner.findOne({ category }, "banners").lean();
    if (!doc) return res.json({ success: true });
    if (index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    await deleteFromCloudinary(doc.banners[index]?.url);

    // $unset the slot then $pull the nulled entry — avoids full array rewrite
    await CategoryBanner.updateOne({ category }, { $unset: { [`banners.${index}`]: 1 } });
    await CategoryBanner.updateOne({ category }, { $pull: { banners: null } });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
