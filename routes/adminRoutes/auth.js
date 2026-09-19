const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Admin = require("../../models/Admin");
const { authMiddleware } = require("./middleware");

const router = express.Router();

// POST /api/admin/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "البريد والكلمة مطلوبان" });

    const admin = await Admin.findOne({ email });
    if (!admin) {
      // Constant-time response to prevent email enumeration via timing
      await bcrypt.compare(password, "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
      return res.status(401).json({ error: "بيانات غير صحيحة" });
    }

    if (admin.isLocked()) {
      return res.status(423).json({ error: "الحساب مقفل مؤقتاً، حاول لاحقاً" });
    }

    const match = await admin.comparePassword(password);
    if (!match) {
      admin.loginAttempts += 1;
      if (admin.loginAttempts >= 5) {
        admin.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      }
      await admin.save();
      return res.status(401).json({ error: "بيانات غير صحيحة" });
    }

    admin.loginAttempts = 0;
    admin.lockUntil = undefined;
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    const isDev = process.env.NODE_ENV === "development";
    res
      .cookie("admin_token", token, {
        httpOnly: true,
        secure: !isDev,
        sameSite: isDev ? "lax" : "none",
        maxAge: 2 * 60 * 60 * 1000,
      })
      .json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/logout
router.post("/logout", (req, res) => {
  const isDev = process.env.NODE_ENV === "development";
  res.clearCookie("admin_token", {
    httpOnly: true,
    secure: !isDev,
    sameSite: isDev ? "lax" : "none",
  }).json({ success: true });
});

// GET /api/admin/verify
router.get("/verify", (req, res) => {
  const token = req.cookies?.admin_token;
  if (!token) return res.status(401).json({ valid: false });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// GET /api/admin/users
router.get("/users", authMiddleware, async (req, res) => {
  try {
    const admins = await Admin.find({}, "-password -loginAttempts -lockUntil");
    res.json(admins);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/users
router.post("/users", authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !phone || !email || !password)
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    const exists = await Admin.findOne({ email });
    if (exists) return res.status(400).json({ error: "البريد مستخدم بالفعل" });
    const admin = await Admin.create({ name, phone, email, password });
    res.status(201).json({ _id: admin._id, name: admin.name, email: admin.email, phone: admin.phone });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/users/:id
router.put("/users/:id", authMiddleware, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !email) return res.status(400).json({ error: "الاسم والبريد مطلوبان" });
    const existing = await Admin.findOne({ email, _id: { $ne: req.params.id } });
    if (existing) return res.status(400).json({ error: "البريد مستخدم بالفعل" });
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: "المستخدم غير موجود" });
    admin.name = name;
    admin.email = email;
    if (phone) admin.phone = phone;
    if (password) admin.password = password;
    await admin.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", authMiddleware, async (req, res) => {
  try {
    // [PERF] Use estimatedDocumentCount for simple count check (faster)
    // Or check if we're deleting the last admin during deletion
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: "المستخدم غير موجود" });
    
    // Check if there's at least one other admin
    const otherAdmin = await Admin.findOne({ _id: { $ne: req.params.id } }).select("_id").lean();
    if (!otherAdmin) return res.status(400).json({ error: "لا يمكن حذف آخر مستخدم" });
    
    await Admin.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
