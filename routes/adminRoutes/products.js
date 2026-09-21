const express = require("express");
const Product = require("../../models/Product");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");
const { invalidateCache } = require("../../controllers/productController");
// [PERF] Invalidate cached sub-categories on every product mutation
// (create / update / delete can change which categories exist or their counts)
const { invalidateSubCatsCache } = require("./categories");

const router = express.Router();

// ─── Upload Image ──────────────────────────────────────────────────────────────
// POST /api/admin/products/upload-image
router.post(
  "/products/upload-image",
  authMiddleware,
  makeImageUpload().single("image"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
      const result = await uploadToCloudinary(req.file.buffer, "products");
      res.json({ url: result.secure_url });
    } catch (err) {
      console.error("upload-image error:", err);
      res.status(500).json({ error: "خطأ في رفع الصورة" });
    }
  }
);

// ─── Create Product ────────────────────────────────────────────────────────────
// POST /api/admin/products
router.post("/products", authMiddleware, async (req, res) => {
  try {
    const body = req.body;
    const productData = {};

    const fields = [
      "name", "image", "category", "subCategory", "brand",
      "color", "storage", "network", "screenSize", "description", "deliveryTime",
    ];
    fields.forEach((f) => { if (body[f]) productData[f] = body[f]; });

    const numFields = ["originalPrice", "salePrice", "warrantyYears"];
    numFields.forEach((f) => {
      if (body[f] !== undefined && body[f] !== "") productData[f] = Number(body[f]);
    });

    const boolFields = ["freeDelivery", "taxIncluded", "inStock"];
    boolFields.forEach((f) => {
      if (body[f] !== undefined) productData[f] = body[f] === "true" || body[f] === true;
    });

    if (body["installment.available"] !== undefined) {
      productData.installment = {
        available:   body["installment.available"] === "true",
        downPayment: body["installment.downPayment"] ? Number(body["installment.downPayment"]) : undefined,
        months:      body["installment.months"]      ? Number(body["installment.months"])      : undefined,
        note:        body["installment.note"] || "",
      };
    }

    const specFields = [
      "screen", "processor", "ram", "storage", "rearCamera",
      "frontCamera", "battery", "batteryLife", "charging", "os", "extras",
    ];
    const specs = {};
    specFields.forEach((f) => { if (body[`specs.${f}`]) specs[f] = body[`specs.${f}`]; });
    if (Object.keys(specs).length) productData.specs = specs;

    if (Array.isArray(body.images)) productData.images = body.images;

    if (body.colors) {
      try { productData.colors = JSON.parse(body.colors); } catch { /* ignore */ }
    }

    const product = await Product.create(productData);
    invalidateCache();
    invalidateSubCatsCache(); // category counts may have changed
    res.status(201).json(product);
  } catch (err) {
    console.error("POST /admin/products error:", err);
    res.status(500).json({ error: err.message || "خطأ في الخادم" });
  }
});

// ─── List Products ─────────────────────────────────────────────────────────────
// GET /api/admin/products?page=1&limit=20&q=iphone&category=هواتف
router.get("/products", authMiddleware, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || PAGE_LIMIT);
    const skip  = (page - 1) * limit;

    // Build filter
    const filter = {};

    // Text search — runs against DB index, not in-memory
    if (req.query.q) {
      const q = String(req.query.q).slice(0, 100); // cap length
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name:        { $regex: escaped, $options: "i" } },
        { category:    { $regex: escaped, $options: "i" } },
        { subCategory: { $regex: escaped, $options: "i" } },
        { brand:       { $regex: escaped, $options: "i" } },
      ];
    }

    // Category filter
    if (req.query.category) {
      const cat = String(req.query.category).slice(0, 100);
      filter.category = { $regex: new RegExp(`^${cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") };
    }

    // [PERF] Run count + paginated fetch in parallel — one round-trip to DB
    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        // Only the fields the admin list actually renders
        .select("name category originalPrice salePrice inStock createdAt")
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      products,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET /admin/products error:", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

const PAGE_LIMIT = 20; // default page size for admin listing

// ─── Get Single Product (Edit) ─────────────────────────────────────────────────
// GET /api/admin/products/:id
// [PERF] Use .lean() to skip Mongoose document overhead.
// We only need the plain JSON — the edit form doesn't use virtuals or methods.
router.get("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .select("-__v -sections -specGroups") // drop heavy fields not used by edit form
      .lean();
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });
    res.json(product);
  } catch (err) {
    console.error("GET /admin/products/:id error:", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ─── Delete Product ────────────────────────────────────────────────────────────
// DELETE /api/admin/products/:id
// [PERF] Delete all Cloudinary images (main + gallery) — prevents orphaned assets.
// deleteFromCloudinary is fire-and-forget after responding to client.
router.delete("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id).lean();
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

    invalidateCache();
    invalidateSubCatsCache(); // category counts may have changed

    // Respond immediately — don't block on Cloudinary cleanup
    res.json({ success: true });

    // Collect all unique Cloudinary URLs to remove
    const allImages = new Set([
      product.image,
      ...(Array.isArray(product.images) ? product.images : []),
    ]);
    for (const url of allImages) {
      if (url) deleteFromCloudinary(url).catch(() => {}); // fire-and-forget
    }
  } catch (err) {
    console.error("DELETE /admin/products/:id error:", err);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ─── Update Product ────────────────────────────────────────────────────────────
// PUT /api/admin/products/:id
router.put("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

    const body = req.body;

    const fields = [
      "name", "category", "subCategory", "brand",
      "color", "storage", "network", "screenSize", "description", "deliveryTime",
    ];
    fields.forEach((f) => { if (body[f] !== undefined) product[f] = body[f]; });

    const numFields = ["originalPrice", "salePrice", "warrantyYears"];
    numFields.forEach((f) => {
      if (body[f] !== undefined) product[f] = body[f] === "" ? undefined : Number(body[f]);
    });

    const boolFields = ["freeDelivery", "taxIncluded", "inStock"];
    boolFields.forEach((f) => {
      if (body[f] !== undefined) product[f] = body[f] === "true" || body[f] === true;
    });

    if (body["installment.available"] !== undefined) {
      const hasInst = product.installment && typeof product.installment === "object";
      const inst = hasInst
        ? (typeof product.installment.toObject === "function"
            ? product.installment.toObject()
            : { ...product.installment })
        : {};
      inst.available   = body["installment.available"] === "true" || body["installment.available"] === true;
      inst.downPayment = body["installment.downPayment"] ? Number(body["installment.downPayment"]) : inst.downPayment;
      inst.months      = body["installment.months"]      ? Number(body["installment.months"])      : inst.months;
      inst.note        = body["installment.note"] ?? inst.note;
      product.installment = inst;
      product.markModified("installment");
    }

    const specFields = [
      "screen", "processor", "ram", "storage", "rearCamera",
      "frontCamera", "battery", "batteryLife", "charging", "os", "extras",
    ];
    const hasSpecs = specFields.some((f) => body[`specs.${f}`] !== undefined);
    if (hasSpecs) {
      const hasSpecsObj = product.specs && typeof product.specs === "object";
      const specs = hasSpecsObj
        ? (typeof product.specs.toObject === "function"
            ? product.specs.toObject()
            : { ...product.specs })
        : {};
      specFields.forEach((f) => { if (body[`specs.${f}`] !== undefined) specs[f] = body[`specs.${f}`]; });
      product.specs = specs;
      product.markModified("specs");
    }

    if (Array.isArray(body.images)) product.images = body.images;
    if (body.image !== undefined)   product.image  = body.image;

    if (body.colors !== undefined) {
      try { product.colors = JSON.parse(body.colors); } catch { /* ignore */ }
    }

    await product.save();
    invalidateCache();
    invalidateSubCatsCache(); // category assignment may have changed
    res.json(product);
  } catch (err) {
    console.error("PUT /admin/products/:id error:", err);
    res.status(500).json({ error: err.message || "خطأ في الخادم" });
  }
});

module.exports = router;
