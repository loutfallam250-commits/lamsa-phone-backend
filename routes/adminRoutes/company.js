const express = require("express");
const Company = require("../../models/Company");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, makeFileUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");

const upload = makeImageUpload();
const uploadFooterImg = makeImageUpload();
const uploadDoc = makeFileUpload();

// [PERF] Single Company cache with proper TTL
let _companyCache = null;
let _companyCacheTs = 0;
const COMPANY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const router = express.Router();

function invalidateCompanyCache() {
  _companyCache = null;
  _companyCacheTs = 0;
}

// GET /api/admin/company
router.get("/company", async (req, res) => {
  try {
    if (_companyCache && Date.now() - _companyCacheTs < COMPANY_CACHE_TTL) {
      return res.json(_companyCache);
    }
    let company = await Company.findOne().lean();
    if (!company) {
      company = (await Company.create({})).toObject();
    }
    // Initialise footerItems only if missing — one extra write, then cached forever
    if (!company.footerItems || company.footerItems.length === 0) {
      const defaultItems = [
        { image: "", linkType: "link", link: "", file: "" },
        { image: "", linkType: "link", link: "", file: "" },
        { image: "", linkType: "link", link: "", file: "" },
      ];
      await Company.updateOne({ _id: company._id }, { $set: { footerItems: defaultItems } });
      company.footerItems = defaultItems;
    }
    _companyCache = company;
    _companyCacheTs = Date.now();
    res.json(company);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/company
router.put("/company", authMiddleware, async (req, res) => {
  try {
    const ALLOWED = [
      "nameAr", "nameEn", "addressAr", "addressEn", "phone", "whatsapp",
      "website", "email", "currencyAr", "currencyEn", "taxNumber",
      "shippingCompany", "paymentMethod", "details", "qrLink", "qrLinkType",
      "link1", "link1Type", "link2", "link2Type", "footerItems",
    ];
    const updates = {};
    ALLOWED.forEach((key) => { if (key in req.body) updates[key] = req.body[key]; });
    const company = await Company.findOneAndUpdate({}, updates, { new: true, upsert: true, lean: true });
    invalidateCompanyCache();
    res.json(company);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/upload/:field
// [PERF] Use lean() to read the old URL, then findOneAndUpdate for the write —
// reduces from 2 full-doc round-trips (findOne + save) to 1 targeted update.
router.post("/company/upload/:field", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { field } = req.params;
    const allowed = ["logo", "header", "footer", "stamp", "cancelStamp"];
    if (!allowed.includes(field)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });

    // Read old URL cheaply
    const existing = await Company.findOne().select(field).lean();
    const oldUrl = existing?.[field] ?? "";

    const result = await uploadToCloudinary(req.file.buffer, "company");
    const url = result.secure_url;

    await Company.findOneAndUpdate({}, { $set: { [field]: url } }, { upsert: true });
    if (oldUrl) await deleteFromCloudinary(oldUrl);

    invalidateCompanyCache();
    res.json({ url });
  } catch (err) {
    console.error("company upload error:", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/company/image/:field
// [PERF] lean() read + targeted $set write instead of findOne + save.
router.delete("/company/image/:field", authMiddleware, async (req, res) => {
  try {
    const { field } = req.params;
    const allowed = ["logo", "header", "footer", "stamp", "cancelStamp"];
    if (!allowed.includes(field)) return res.status(400).json({ error: "حقل غير مسموح" });

    const existing = await Company.findOne().select(field).lean();
    if (!existing) return res.json({ success: true });
    const oldUrl = existing[field] ?? "";

    await Company.findOneAndUpdate({}, { $set: { [field]: "" } });
    if (oldUrl) await deleteFromCloudinary(oldUrl);

    invalidateCompanyCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-image/:key
// [PERF] lean() read + targeted $set write.
router.post("/company/footer-image/:key", authMiddleware, uploadFooterImg.single("image"), async (req, res) => {
  try {
    const { key } = req.params;
    if (!["qrImage", "img1", "img2"].includes(key)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });

    const existing = await Company.findOne().select(key).lean();
    const oldUrl = existing?.[key] ?? "";

    const result = await uploadToCloudinary(req.file.buffer, "company");
    const url = result.secure_url;

    await Company.findOneAndUpdate({}, { $set: { [key]: url } }, { upsert: true });
    if (oldUrl) await deleteFromCloudinary(oldUrl);

    invalidateCompanyCache();
    res.json({ url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-file/:key
// [PERF] lean() read + targeted $set write.
router.post("/company/footer-file/:key", authMiddleware, uploadDoc.single("file"), async (req, res) => {
  try {
    const { key } = req.params;
    if (!["file1", "file2", "qrFile"].includes(key)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });

    const existing = await Company.findOne().select(key).lean();
    const oldUrl = existing?.[key] ?? "";

    const result = await uploadToCloudinary(req.file.buffer, "docs", { resource_type: "raw" });
    const url = result.secure_url;

    await Company.findOneAndUpdate({}, { $set: { [key]: url } }, { upsert: true });
    if (oldUrl) await deleteFromCloudinary(oldUrl, "raw");

    invalidateCompanyCache();
    res.json({ url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/image/:index
// [PERF] lean() read for old URL + positional $set write.
router.post("/company/footer-items/image/:index", authMiddleware, uploadFooterImg.single("image"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });

    const existing = await Company.findOne().select("footerItems").lean();
    if (!existing) return res.status(404).json({ error: "الشركة غير موجودة" });
    if (isNaN(index) || index < 0 || index >= existing.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });

    const oldUrl = existing.footerItems[index]?.image ?? "";
    const result = await uploadToCloudinary(req.file.buffer, "company");
    const url = result.secure_url;

    await Company.findOneAndUpdate(
      {},
      { $set: { [`footerItems.${index}.image`]: url } }
    );
    if (oldUrl) await deleteFromCloudinary(oldUrl);

    invalidateCompanyCache();
    res.json({ url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/file/:index
// [PERF] lean() read for old URL + positional $set write.
router.post("/company/footer-items/file/:index", authMiddleware, uploadDoc.single("file"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });

    const existing = await Company.findOne().select("footerItems").lean();
    if (!existing) return res.status(404).json({ error: "الشركة غير موجودة" });
    if (isNaN(index) || index < 0 || index >= existing.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });

    const oldUrl = existing.footerItems[index]?.file ?? "";
    const result = await uploadToCloudinary(req.file.buffer, "docs", { resource_type: "raw" });
    const url = result.secure_url;

    await Company.findOneAndUpdate(
      {},
      { $set: { [`footerItems.${index}.file`]: url } }
    );
    if (oldUrl) await deleteFromCloudinary(oldUrl, "raw");

    invalidateCompanyCache();
    res.json({ url });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/add
// [PERF] Atomic $push — no findOne + push + save needed.
router.post("/company/footer-items/add", authMiddleware, async (req, res) => {
  try {
    const newItem = { image: "", linkType: "link", link: "", file: "" };
    const company = await Company.findOneAndUpdate(
      {},
      { $push: { footerItems: newItem } },
      { new: true, upsert: true, lean: true }
    );
    invalidateCompanyCache();
    res.json({ index: company.footerItems.length - 1 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/company/footer-items/:index
// [PERF] lean() read for old URLs, then targeted $unset + $pull in two ops —
// still fewer allocations than full-doc save with markModified.
router.delete("/company/footer-items/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);

    const existing = await Company.findOne().select("footerItems").lean();
    if (!existing) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= existing.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });

    const item = existing.footerItems[index];

    // MongoDB doesn't support pulling by index directly; use null-sentinel pattern:
    // 1. Set the element to null, 2. Pull all nulls
    await Company.findOneAndUpdate(
      {},
      { $unset: { [`footerItems.${index}`]: 1 } }
    );
    await Company.findOneAndUpdate(
      {},
      { $pull: { footerItems: null } }
    );

    if (item?.image) await deleteFromCloudinary(item.image);
    if (item?.file)  await deleteFromCloudinary(item.file, "raw");

    invalidateCompanyCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
