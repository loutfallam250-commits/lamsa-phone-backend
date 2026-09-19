require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const productRoutes = require("./routes/productRoutes");
const checkoutRoutes = require("./routes/checkoutRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
app.set("trust proxy", 1);

// Register /ping before DB connection — always responds 200
app.get("/ping", (_req, res) => res.json({ ok: true, ts: Date.now() }));

connectDB();
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",").map((o) => o.trim());

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// [FIX C1] Global NoSQL injection sanitizer — strip any query param that is an object (e.g. ?x[$ne]=y)
app.use((req, _res, next) => {
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (typeof req.query[key] === "object") delete req.query[key];
    }
  }
  next();
});

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: "طلبات كثيرة، حاول لاحقاً" } });
app.use("/api", globalLimiter);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: "محاولات كثيرة، حاول بعد 15 دقيقة" } });
app.use("/api/admin/login", loginLimiter);

app.get("/", (req, res) => {
  res.json({ message: "API is running..." });
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/products", (req, res, next) => {
  if (req.method === "GET") {
    // Aggressive caching for product lists (2 minutes CDN, 5 minutes stale)
    res.set("Cache-Control", "public, max-age=120, s-maxage=120, stale-while-revalidate=300");
  }
  next();
}, productRoutes);

// Cache-Control for public read-only admin endpoints
app.use("/api/admin/company", (req, res, next) => {
  if (req.method === "GET") {
    // Long cache for company data (5 minutes CDN, 1 hour stale)
    res.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
  }
  next();
});

app.use("/api/admin/sub-categories/home-settings", (req, res, next) => {
  if (req.method === "GET") {
    // Cache home settings (5 minutes CDN, 1 hour stale)
    res.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
  }
  next();
});

app.use("/api/admin/sub-categories/max", (req, res, next) => {
  if (req.method === "GET") {
    // Cache max settings (5 minutes CDN, 1 hour stale)
    res.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
  }
  next();
});

app.use("/api/admin/category-banners-bulk", (req, res, next) => {
  if (req.method === "GET") {
    // Cache banners (2 minutes CDN, 10 minutes stale)
    res.set("Cache-Control", "public, max-age=120, s-maxage=120, stale-while-revalidate=600");
  }
  next();
});

app.use("/api/admin/reviews", (req, res, next) => {
  if (req.method === "GET") {
    // Cache reviews (1 hour CDN, 6 hours stale)
    res.set("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=21600");
  }
  next();
});

app.use("/api/checkout", checkoutRoutes);
app.use("/api/admin", adminRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
