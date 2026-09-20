const Product = require("../models/Product");

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared cache (per worker, but TTL prevents stale data)
const cache = new Map();
const CACHE_TTL = 2 * 60 * 1000; // Reduced to 2 minutes for more frequent updates
const SEARCH_TTL = 60 * 1000; // 1 minute for search

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key, data, ttl = CACHE_TTL) {
  if (cache.size >= 150) {
    // LRU-style: delete oldest entry instead of clearing all
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, ts: Date.now(), ttl });
}

exports.invalidateCache = () => cache.clear();

const ALLOWED_PUBLIC_FIELDS = new Set([
  "name", "originalPrice", "salePrice", "image", "images",
  "color", "storage", "category", "subCategory", "brand",
  "inStock", "freeDelivery", "warrantyYears", "installment",
  "discountPercent", "network", "price", "taxIncluded",
  "deliveryTime", "overview", "features", "detailedSpecs",
  "description", "specs", "specGroups", "screenSize", "variants",
  "brief", "sections",
]);

// Minimal fields for list/card views
const LIST_VIEW_FIELDS = "name originalPrice salePrice image images color storage category subCategory brand inStock freeDelivery warrantyYears installment discountPercent network price";

function sanitizeFields(fields) {
  if (!fields) return "";
  return fields
    .split(",")
    .map((f) => f.trim())
    .filter((f) => ALLOWED_PUBLIC_FIELDS.has(f))
    .join(" ");
}

// Strip __v from any product object after lean()
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

// Add discountPercent if missing (handle virtual fields with lean())
function enrichProduct(p) {
  if (p.discountPercent == null && p.salePrice && p.originalPrice > p.salePrice) {
    p.discountPercent = Math.round(((p.originalPrice - p.salePrice) / p.originalPrice) * 100);
  }
  return stripMeta(p);
}

// [NEW] Optimized endpoint for category pages with advanced filtering
exports.getProductsByCategory = async (req, res) => {
  try {
    const { category, subCategory, brand, nameIncludes, nameExcludes, fields, page, limit, sort } = req.query;
    
    // Sanitize inputs
    const safeCategory = category && typeof category === "string" && !category.includes("$") ? category : undefined;
    const safeSubCategory = subCategory && typeof subCategory === "string" && !subCategory.includes("$") ? subCategory : undefined;
    const safeBrand = brand && typeof brand === "string" && !brand.includes("$") ? brand : undefined;
    const safeSort = sort && typeof sort === "string" && ["price-asc", "price-desc", "date-desc", "name-asc", "storage-asc"].includes(sort) ? sort : "storage-asc";
    const selectFields = sanitizeFields(fields);
    
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 50));
    
    // Build cache key
    const cacheKey = `cat:${safeCategory || ""}:${safeSubCategory || ""}:${safeBrand || ""}:${nameIncludes || ""}:${nameExcludes || ""}:${selectFields}:${pageNum}:${limitNum}:${safeSort}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
    
    // Build filter
    const filter = {};
    
    if (safeCategory) {
      const normalizedCategory = normalizeArabic(safeCategory);
      filter.$or = [
        { category: { $regex: new RegExp(escapeRegex(normalizedCategory), "i") } },
        { subCategory: { $regex: new RegExp(escapeRegex(normalizedCategory), "i") } }
      ];
    }
    
    if (safeSubCategory) {
      filter.subCategory = { $regex: new RegExp(escapeRegex(normalizeArabic(safeSubCategory)), "i") };
    }
    
    if (safeBrand) {
      filter.brand = { $regex: new RegExp(`^${escapeRegex(safeBrand)}$`, "i") };
    }
    
    // Name includes/excludes filtering (done in DB for better performance)
    if (nameIncludes) {
      const keywords = nameIncludes.split(",").map(k => k.trim()).filter(Boolean);
      if (keywords.length > 0) {
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: keywords.map(kw => ({ name: { $regex: escapeRegex(kw), $options: "i" } }))
        });
      }
    }
    
    if (nameExcludes) {
      const excludeKeywords = nameExcludes.split(",").map(k => k.trim()).filter(Boolean);
      if (excludeKeywords.length > 0) {
        filter.$and = filter.$and || [];
        excludeKeywords.forEach(kw => {
          filter.$and.push({
            name: { $not: { $regex: escapeRegex(kw), $options: "i" } }
          });
        });
      }
    }
    
    // Build sort
    let sortObj = {};
    if (safeSort === "price-asc") sortObj = { salePrice: 1, originalPrice: 1 };
    else if (safeSort === "price-desc") sortObj = { salePrice: -1, originalPrice: -1 };
    else if (safeSort === "name-asc") sortObj = { name: 1 };
    else if (safeSort === "storage-asc") sortObj = { storage: 1, color: 1 };
    else sortObj = { createdAt: -1 };
    
    // Execute query
    const [rawProducts, total] = await Promise.all([
      Product.find(filter)
        .select(selectFields || "-__v")
        .sort(sortObj)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean({ virtuals: false }),
      Product.countDocuments(filter)
    ]);
    
    const products = rawProducts.map(enrichProduct);
    const result = { products, total, page: pageNum, pages: Math.ceil(total / limitNum) };
    
    setCached(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error("getProductsByCategory error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const { q, fields, page, limit, brand, category, subCategory, sort } = req.query;
    // Sanitize — reject any non-string (object) query param to block NoSQL injection
    const safeBrand = brand && typeof brand === "string" && !brand.includes("$") ? brand : undefined;
    const safeCategory = category && typeof category === "string" && !category.includes("$") ? category : undefined;
    const safeSubCategory = subCategory && typeof subCategory === "string" && !subCategory.includes("$") ? subCategory : undefined;
    const safeSort = sort && typeof sort === "string" && ["price-asc", "price-desc", "date-desc", "name-asc"].includes(sort) ? sort : "date-desc";
    const selectFields = sanitizeFields(fields);
    const filter = {};
    if (safeBrand) filter.brand = { $regex: new RegExp(`^${escapeRegex(safeBrand)}$`, "i") };
    if (safeCategory) filter.category = { $regex: new RegExp(`^${escapeRegex(safeCategory)}$`, "i") };
    if (safeSubCategory) filter.subCategory = { $regex: new RegExp(`^${escapeRegex(safeSubCategory)}$`, "i") };

    // Search — with short cache
    if (q) {
      const normalized = normalizeArabic(q);
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, Math.min(50, parseInt(limit) || 20));
      const searchCacheKey = `search:${normalized}:${safeBrand || ""}:${safeCategory || ""}:${safeSubCategory || ""}:${selectFields}:${pageNum}:${limitNum}:${safeSort}`;
      const cachedSearch = getCached(searchCacheKey);
      if (cachedSearch) return res.json(cachedSearch);
      
      const searchRegex = { $regex: escapeRegex(normalized), $options: "i" };
      
      // Build sort object
      let sortObj = {};
      if (safeSort === "price-asc") sortObj = { salePrice: 1, originalPrice: 1 };
      else if (safeSort === "price-desc") sortObj = { salePrice: -1, originalPrice: -1 };
      else if (safeSort === "name-asc") sortObj = { name: 1 };
      else sortObj = { createdAt: -1 };
      
      const rawProducts = await Product.find({
        ...filter,
        $or: [
          { name: searchRegex },
          { category: searchRegex },
          { subCategory: searchRegex },
          { brand: searchRegex },
        ],
      })
      .select(selectFields || "-__v")
      .sort(sortObj)
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum)
      .lean({ virtuals: false }); // Disable virtuals to reduce overhead
      
      const products = rawProducts.map(enrichProduct);
      setCached(searchCacheKey, products, SEARCH_TTL);
      return res.json(products);
    }

    // Paginated listing with cache
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(500, parseInt(limit) || 20));
    const cacheKey = `products:${brand || ""}:${category || ""}:${subCategory || ""}:${selectFields}:${pageNum}:${limitNum}:${safeSort}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Build sort object
    let sortObj = {};
    if (safeSort === "price-asc") sortObj = { salePrice: 1, originalPrice: 1 };
    else if (safeSort === "price-desc") sortObj = { salePrice: -1, originalPrice: -1 };
    else if (safeSort === "name-asc") sortObj = { name: 1 };
    else sortObj = { createdAt: -1 };

    // Use parallel queries to reduce time
    const query = Product.find(filter)
      .select(selectFields || "-__v")
      .sort(sortObj)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean({ virtuals: false });
      
    const [rawProducts, total] = await Promise.all([
      query,
      Product.countDocuments(filter)
    ]);
    
    const products = rawProducts.map(enrichProduct);
    const result = { products, total, page: pageNum, pages: Math.ceil(total / limitNum) };
    setCached(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error("getProducts error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const { fields } = req.query;
    const selectFields = fields ? sanitizeFields(fields) : "";
    const cacheKey = `product:${req.params.id}:${selectFields}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const product = await Product.findById(req.params.id)
      .select(selectFields || "-__v")
      .lean({ virtuals: false });

    if (!product) return res.status(404).json({ message: "Product not found" });

    enrichProduct(product);
    setCached(cacheKey, product);
    res.json(product);
  } catch (err) {
    console.error("getProduct error:", err);
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
    console.error("createProduct error:", err);
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
    console.error("updateProduct error:", err);
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
    console.error("deleteProduct error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
