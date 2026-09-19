const Product = require("../models/Product");

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared cache (per worker, but TTL prevents stale data)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const SEARCH_TTL = 2 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key, data) {
  if (cache.size >= 100) {
    // LRU-style: delete oldest entry instead of clearing all
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, ts: Date.now() });
}

exports.invalidateCache = () => cache.clear();

const ALLOWED_PUBLIC_FIELDS = new Set([
  "name", "originalPrice", "salePrice", "image", "images",
  "color", "storage", "category", "subCategory", "brand",
  "inStock", "freeDelivery", "warrantyYears", "installment",
  "discountPercent", "network", "price", "taxIncluded",
  "deliveryTime", "overview", "features", "detailedSpecs",
  "description", "specs", "screenSize", "variants",
]);

function sanitizeFields(fields) {
  if (!fields) return "";
  return fields
    .split(",")
    .map((f) => f.trim())
    .filter((f) => ALLOWED_PUBLIC_FIELDS.has(f))
    .join(" ");
}

// [FIX C2] Strip __v from any product object after lean()
function stripMeta(p) {
  if (p && typeof p === "object") delete p.__v;
  return p;
}

function normalizeArabic(str) {
  return str
    .replace(/[أإآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

exports.getProducts = async (req, res) => {
  try {
    const { q, fields, page, limit, brand, category } = req.query;
    // [FIX C1] Sanitize — reject any non-string (object) query param to block NoSQL injection
    const safeBrand = brand && typeof brand === "string" && !brand.includes("$") ? brand : undefined;
    const safeCategory = category && typeof category === "string" && !category.includes("$") ? category : undefined;
    const selectFields = sanitizeFields(fields);
    const filter = {};
    if (safeBrand) filter.brand = { $regex: new RegExp(`^${escapeRegex(safeBrand)}$`, "i") };
    if (safeCategory) filter.category = { $regex: new RegExp(`^${escapeRegex(safeCategory)}$`, "i") };

    // Search — with short cache
    if (q) {
      const normalized = normalizeArabic(q);
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, Math.min(50, parseInt(limit) || 20));
      const searchCacheKey = `search:${normalized}:${safeBrand || ""}:${safeCategory || ""}:${selectFields}:${pageNum}:${limitNum}`;
      const cachedSearch = getCached(searchCacheKey);
      if (cachedSearch) return res.json(cachedSearch);
      const searchRegex = { $regex: escapeRegex(normalized), $options: "i" };
      const rawProducts = await Product.find({
        ...filter,
        $or: [
          { name: searchRegex },
          { category: searchRegex },
          { subCategory: searchRegex },
          { brand: searchRegex },
        ],
      }).select(selectFields).limit(limitNum).skip((pageNum - 1) * limitNum).lean({ virtuals: true });
      const products = rawProducts.map((p) => {
        if (p.discountPercent == null && p.salePrice && p.originalPrice > p.salePrice) {
          p.discountPercent = Math.round(((p.originalPrice - p.salePrice) / p.originalPrice) * 100);
        }
        return stripMeta(p);
      });
      setCached(searchCacheKey, products);
      cache.get(searchCacheKey).ts -= CACHE_TTL - SEARCH_TTL;
      return res.json(products);
    }

    // Paginated listing with cache
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(500, parseInt(limit) || 20));
    const cacheKey = `products:${brand || ""}:${category || ""}:${selectFields}:${pageNum}:${limitNum}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const query = Product.find(filter).select(selectFields).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean({ virtuals: true });
    const [rawProducts, total] = await Promise.all([query, Product.countDocuments(filter)]);
    // Ensure discountPercent is always present even if virtual didn't attach
    const products = rawProducts.map((p) => {
      if (p.discountPercent == null && p.salePrice && p.originalPrice > p.salePrice) {
        p.discountPercent = Math.round(((p.originalPrice - p.salePrice) / p.originalPrice) * 100);
      }
      return stripMeta(p);
    });
    const result = { products, total, page: pageNum, pages: Math.ceil(total / limitNum) };
    setCached(cacheKey, result);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const cacheKey = `product:${req.params.id}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const product = await Product.findById(req.params.id).lean({ virtuals: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (product.discountPercent == null && product.salePrice && product.originalPrice > product.salePrice) {
      product.discountPercent = Math.round(((product.originalPrice - product.salePrice) / product.originalPrice) * 100);
    }
    stripMeta(product);
    setCached(cacheKey, product);
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

const PRODUCT_ALLOWED_FIELDS = [
  "name", "originalPrice", "salePrice", "description", "image", "images",
  "color", "storage", "network", "screenSize", "specs", "specGroups", "freeDelivery",
  "deliveryTime", "warrantyYears", "installment", "taxIncluded", "category",
  "subCategory", "brand", "inStock", "variants", "overview", "features", "detailedSpecs",
];

function pickAllowed(body) {
  return PRODUCT_ALLOWED_FIELDS.reduce((acc, key) => {
    if (key in body) acc[key] = body[key];
    return acc;
  }, {});
}

exports.createProduct = async (req, res) => {
  try {
    const product = await Product.create(pickAllowed(req.body));
    exports.invalidateCache();
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, pickAllowed(req.body), { new: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    exports.invalidateCache();
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    exports.invalidateCache();
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
