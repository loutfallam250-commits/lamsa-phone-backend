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

// [PERF] Helper to get or create company document once
async function getOrCreateCompany() {
  if (_companyCache && Date.now() - _companyCacheTs < COMPANY_CACHE_TTL) {
    return _companyCache;
  }
  let company = await Company.findOne().lean();
  if (!company) {
    company = await Company.create({});
    company = company.toObject();
  }
  _companyCache = company;
  _companyCacheTs = Date.now();
  return company;
}

function invalidateCompanyCache() {
  _companyCache = null;
  _companyCacheTs = 0;
}

// POST /api/admin/company/upload/:field
router.post("/company/upload/:field", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { field } = req.params;
    const allowed = ["logo", "header", "footer", "stamp", "cancelStamp"];
    if (!allowed.includes(field)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    const result = await uploadToCloudinary(req.file.buffer, "company");
    const url = result.secure_url;
    // [PERF] Use findOneAndUpdate instead of find + save
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    const oldUrl = company[field];
    company[field] = url;
    await company.save();
    // Delete old image after successful save
    if (oldUrl) await deleteFromCloudinary(oldUrl);
    invalidateCompanyCache();
    res.json({ url });
  } catch (err) {
    console.error("company upload error:", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/company/image/:field
router.delete("/company/image/:field", authMiddleware, async (req, res) => {
  try {
    const { field } = req.params;
    const allowed = ["logo", "header", "footer", "stamp", "cancelStamp"];
    if (!allowed.includes(field)) return res.status(400).json({ error: "حقل غير مسموح" });
    const company = await Company.findOne();
    if (!company) return res.json({ success: true });
    const oldUrl = company[field];
    company[field] = "";
    await company.save();
    if (oldUrl) await deleteFromCloudinary(oldUrl);
    invalidateCompanyCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/company
router.get("/company", async (req, res) => {
  try {
    // [PERF] Return cached company if still valid
    if (_companyCache && Date.now() - _companyCacheTs < COMPANY_CACHE_TTL) {
      return res.json(_companyCache);
    }
    let company = await Company.findOne().lean();
    if (!company) {
      company = await Company.create({});
      company = company.toObject();
    }
    // [PERF] Initialize footerItems only if needed
    if (!company.footerItems || company.footerItems.length === 0) {
      await Company.updateOne(
        { _id: company._id },
        {
          $set: {
            footerItems: [
              { image: "", linkType: "link", link: "", file: "" },
              { image: "", linkType: "link", link: "", file: "" },
              { image: "", linkType: "link", link: "", file: "" },
            ],
          },
        }
      );
      company.footerItems = [
        { image: "", linkType: "link", link: "", file: "" },
        { image: "", linkType: "link", link: "", file: "" },
        { image: "", linkType: "link", link: "", file: "" },
      ];
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
    // [PERF] Build update object instead of loading full document
    const updates = {};
    ALLOWED.forEach((key) => { if (key in req.body) updates[key] = req.body[key]; });
    
    const company = await Company.findOneAndUpdate({}, updates, { new: true, upsert: true }).lean();
    invalidateCompanyCache();
    res.json(company);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-image/:key
router.post("/company/footer-image/:key", authMiddleware, uploadFooterImg.single("image"), async (req, res) => {
  try {
    const { key } = req.params;
    if (!["qrImage", "img1", "img2"].includes(key)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    const oldUrl = company[key];
    const result = await uploadToCloudinary(req.file.buffer, "company");
    company[key] = result.secure_url;
    await company.save();
    if (oldUrl) await deleteFromCloudinary(oldUrl);
    invalidateCompanyCache();
    res.json({ url: company[key] });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-file/:key
router.post("/company/footer-file/:key", authMiddleware, uploadDoc.single("file"), async (req, res) => {
  try {
    const { key } = req.params;
    if (!["file1", "file2", "qrFile"].includes(key)) return res.status(400).json({ error: "حقل غير مسموح" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    const oldUrl = company[key];
    const result = await uploadToCloudinary(req.file.buffer, "docs", { resource_type: "raw" });
    company[key] = result.secure_url;
    await company.save();
    if (oldUrl) await deleteFromCloudinary(oldUrl, "raw");
    invalidateCompanyCache();
    res.json({ url: company[key] });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/image/:index
router.post("/company/footer-items/image/:index", authMiddleware, uploadFooterImg.single("image"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    if (isNaN(index) || index < 0 || index >= company.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });
    const old = company.footerItems[index]?.image;
    const result = await uploadToCloudinary(req.file.buffer, "company");
    company.footerItems[index].image = result.secure_url;
    company.markModified("footerItems");
    await company.save();
    if (old) await deleteFromCloudinary(old);
    invalidateCompanyCache();
    res.json({ url: company.footerItems[index].image });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/file/:index
router.post("/company/footer-items/file/:index", authMiddleware, uploadDoc.single("file"), async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    if (isNaN(index) || index < 0 || index >= company.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });
    const old = company.footerItems[index]?.file;
    const result = await uploadToCloudinary(req.file.buffer, "docs", { resource_type: "raw" });
    company.footerItems[index].file = result.secure_url;
    company.markModified("footerItems");
    await company.save();
    if (old) await deleteFromCloudinary(old, "raw");
    invalidateCompanyCache();
    res.json({ url: company.footerItems[index].file });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/company/footer-items/add
router.post("/company/footer-items/add", authMiddleware, async (req, res) => {
  try {
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    company.footerItems.push({ image: "", linkType: "link", link: "", file: "" });
    await company.save();
    invalidateCompanyCache();
    res.json({ index: company.footerItems.length - 1 });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/company/footer-items/:index
router.delete("/company/footer-items/:index", authMiddleware, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let company = await Company.findOne();
    if (!company) return res.json({ success: true });
    if (isNaN(index) || index < 0 || index >= company.footerItems.length)
      return res.status(400).json({ error: "رقم غير صحيح" });
    const item = company.footerItems[index];
    company.footerItems.splice(index, 1);
    company.markModified("footerItems");
    await company.save();
    // Delete files after successful save
    if (item.image) await deleteFromCloudinary(item.image);
    if (item.file) await deleteFromCloudinary(item.file, "raw");
    invalidateCompanyCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
