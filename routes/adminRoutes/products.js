const express = require("express");
const Product = require("../../models/Product");
const { authMiddleware } = require("./middleware");
const { makeImageUpload, uploadToCloudinary, deleteFromCloudinary } = require("../../config/cloudinary");

const { invalidateCache } = require("../../controllers/productController");
const router = express.Router();

// POST /api/admin/products/upload-image
router.post("/products/upload-image", authMiddleware, makeImageUpload().single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع صورة" });
    const result = await uploadToCloudinary(req.file.buffer, "products");
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error("upload-image error:", err);
    res.status(500).json({ error: "خطأ في رفع الصورة" });
  }
});

// POST /api/admin/products
router.post("/products", authMiddleware, async (req, res) => {
  try {
    const body = req.body;
    const productData = {};

    const fields = ["name", "image", "category", "subCategory", "brand", "color", "storage", "network", "screenSize", "description", "deliveryTime"];
    fields.forEach((f) => { if (body[f]) productData[f] = body[f]; });

    const numFields = ["originalPrice", "salePrice", "warrantyYears"];
    numFields.forEach((f) => { if (body[f] !== undefined && body[f] !== "") productData[f] = Number(body[f]); });

    const boolFields = ["freeDelivery", "taxIncluded", "inStock"];
    boolFields.forEach((f) => { if (body[f] !== undefined) productData[f] = body[f] === "true" || body[f] === true; });

    if (body["installment.available"] !== undefined) {
      productData.installment = {
        available: body["installment.available"] === "true",
        downPayment: body["installment.downPayment"] ? Number(body["installment.downPayment"]) : undefined,
        months: body["installment.months"] ? Number(body["installment.months"]) : undefined,
        note: body["installment.note"] || "",
      };
    }

    const specFields = ["screen", "processor", "ram", "storage", "rearCamera", "frontCamera", "battery", "batteryLife", "charging", "os", "extras"];
    const specs = {};
    specFields.forEach((f) => { if (body[`specs.${f}`]) specs[f] = body[`specs.${f}`]; });
    if (Object.keys(specs).length) productData.specs = specs;

    if (Array.isArray(body.images)) productData.images = body.images;

    if (body.colors) {
      try { productData.colors = JSON.parse(body.colors); } catch { /* ignore */ }
    }

    const product = await Product.create(productData);
    invalidateCache();
    res.status(201).json(product);
  } catch (err) {
    console.error("POST /products error:", err);
    res.status(500).json({ error: err.message || "خطأ في الخادم" });
  }
});

// GET /api/admin/products
router.get("/products", authMiddleware, async (req, res) => {
  try {
    // [PERF] Add pagination to avoid loading all products
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    
    const [products, total] = await Promise.all([
      Product.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("name category originalPrice salePrice inStock createdAt")
        .lean(),
      Product.countDocuments(),
    ]);
    
    res.json({
      products,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/products/:id
router.get("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });
    res.json(product);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/products/:id
router.delete("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });
    invalidateCache();
    await deleteFromCloudinary(product.image);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/products/:id
router.put("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

    const body = req.body;
    const fields = ["name", "category", "subCategory", "brand", "color", "storage", "network", "screenSize", "description", "deliveryTime"];
    fields.forEach((f) => { if (body[f] !== undefined) product[f] = body[f]; });

    const numFields = ["originalPrice", "salePrice", "warrantyYears"];
    numFields.forEach((f) => { if (body[f] !== undefined) product[f] = body[f] === "" ? undefined : Number(body[f]); });

    const boolFields = ["freeDelivery", "taxIncluded", "inStock"];
    boolFields.forEach((f) => { if (body[f] !== undefined) product[f] = body[f] === "true" || body[f] === true; });

    if (body["installment.available"] !== undefined) {
      const hasInstallment = product.installment && typeof product.installment === "object";
      const inst = hasInstallment
        ? (typeof product.installment.toObject === "function" ? product.installment.toObject() : { ...product.installment })
        : {};
      inst.available = body["installment.available"] === "true" || body["installment.available"] === true;
      inst.downPayment = body["installment.downPayment"] ? Number(body["installment.downPayment"]) : inst.downPayment;
      inst.months = body["installment.months"] ? Number(body["installment.months"]) : inst.months;
      inst.note = body["installment.note"] ?? inst.note;
      product.installment = inst;
      product.markModified("installment");
    }

    const specFields = ["screen", "processor", "ram", "storage", "rearCamera", "frontCamera", "battery", "batteryLife", "charging", "os", "extras"];
    const hasSpecs = specFields.some((f) => body[`specs.${f}`] !== undefined);
    if (hasSpecs) {
      const hasSpecsObject = product.specs && typeof product.specs === "object";
      const specs = hasSpecsObject
        ? (typeof product.specs.toObject === "function" ? product.specs.toObject() : { ...product.specs })
        : {};
      specFields.forEach((f) => { if (body[`specs.${f}`] !== undefined) specs[f] = body[`specs.${f}`]; });
      product.specs = specs;
      product.markModified("specs");
    }

    if (Array.isArray(body.images)) product.images = body.images;
    if (body.image !== undefined) product.image = body.image;

    if (body.colors !== undefined) {
      try { product.colors = JSON.parse(body.colors); } catch { /* ignore */ }
    }

    await product.save();
    invalidateCache();
    res.json(product);
  } catch (err) {
    console.error("PUT /products/:id error:", err);
    res.status(500).json({ error: err.message || "خطأ في الخادم" });
  }
});

module.exports = router;
