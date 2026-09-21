const express = require("express");
const Banner = require("../../models/Banner");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");

const uploadBanner = makeImageUpload();
const router = express.Router();

const DEFAULT_BANNERS = Array(5).fill(null).map(() => ({ url: "", active: true }));

/** Ensure the singleton Banner doc exists and return it (lean or full) */
async function ensureBannerDoc() {
  // findOneAndUpdate with upsert — single round-trip, race-safe
  return Banner.findOneAndUpdate(
    {},
    { $setOnInsert: { banners: DEFAULT_BANNERS } },
    { upsert: true, new: true }
  );
}

// GET /api/admin/banners
router.get("/banners", async (req, res) => {
  try {
    const doc = await Banner.findOne({}, "banners").lean();
    if (!doc) {
      // First-ever request: create default doc
      const created = await Banner.findOneAndUpdate(
        {},
        { $setOnInsert: { banners: DEFAULT_BANNERS } },
        { upsert: true, new: true }
      );
      return res.json(created.banners);
    }
    res.json(doc.banners);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banners/upload/:index
router.post("/banners/upload/:index", authMiddleware, uploadBanner.single("image"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });

    const doc = await ensureBannerDoc();
    if (index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    // Delete old image then upload new one
    const oldUrl = doc.banners[index]?.url;
    await deleteFromCloudinary(oldUrl);
    const result = await uploadToCloudinary(req.file.buffer, "banners");
    const url = result.secure_url;

    // Targeted $set — only update the affected array index
    await Banner.updateOne({}, { $set: { [`banners.${index}.url`]: url } });

    res.json({ url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/banners/toggle/:index
router.patch("/banners/toggle/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    const doc = await Banner.findOne({}, `banners.${index}`).lean();
    if (!doc) return res.status(404).json({ error: "لا يوجد" });
    if (index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    const newActive = !doc.banners[index].active;
    // Targeted $set — single field
    await Banner.updateOne({}, { $set: { [`banners.${index}.active`]: newActive } });

    res.json({ active: newActive });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/banners/add
router.post("/banners/add", authMiddleware, async (req, res) => {
  try {
    const doc = await ensureBannerDoc();
    if (doc.banners.length >= 10) return res.status(400).json({ error: "الحد الأقصى 10 بانرات" });

    // $push — atomic append, no full-doc load needed
    await Banner.updateOne({}, { $push: { banners: { url: "", active: true } } });

    res.json({ index: doc.banners.length }); // new index = old length
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banners/:index/image
router.delete("/banners/:index/image", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    const doc = await Banner.findOne({}, `banners.${index}`).lean();
    if (!doc) return res.json({ success: true });
    if (index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    await deleteFromCloudinary(doc.banners[index]?.url);
    await Banner.updateOne({}, { $set: { [`banners.${index}.url`]: "" } });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/banners/:index
router.delete("/banners/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    const doc = await Banner.findOne({}, "banners").lean();
    if (!doc) return res.json({ success: true });
    if (index >= doc.banners.length) return res.status(400).json({ error: "رقم بانر غير صحيح" });

    await deleteFromCloudinary(doc.banners[index]?.url);

    // Use $unset + $pull pattern for positional array element removal
    await Banner.updateOne({}, { $unset: { [`banners.${index}`]: 1 } });
    await Banner.updateOne({}, { $pull: { banners: null } });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
