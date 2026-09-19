const express = require("express");
const Review = require("../../models/Review");
const { authMiddleware } = require("./middleware");

const router = express.Router();

// [PERF] Cache for public approved reviews
let _reviewsCache = null;
let _reviewsCacheTs = 0;
const REVIEWS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function invalidateReviewsCache() {
  _reviewsCache = null;
  _reviewsCacheTs = 0;
}

// GET /api/admin/reviews (public - approved only)
router.get("/reviews", async (req, res) => {
  try {
    // [PERF] Return cached reviews if available
    if (_reviewsCache && Date.now() - _reviewsCacheTs < REVIEWS_CACHE_TTL) {
      return res.json(_reviewsCache);
    }
    
    const reviews = await Review.find({ approved: true })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("name comment rating gender createdAt")
      .lean();
    
    _reviewsCache = reviews;
    _reviewsCacheTs = Date.now();
    res.json(reviews);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// GET /api/admin/reviews/all (admin - all reviews)
router.get("/reviews/all", authMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.json(reviews);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/reviews (public - submit review)
router.post("/reviews", async (req, res) => {
  try {
    const { name, comment, rating, gender } = req.body;
    if (!name || !comment) return res.status(400).json({ error: "الاسم والتعليق مطلوبان" });
    if (typeof name !== "string" || name.trim().length > 100)
      return res.status(400).json({ error: "الاسم غير صحيح" });
    if (typeof comment !== "string" || comment.trim().length > 1000)
      return res.status(400).json({ error: "التعليق غير صحيح" });
    const ratingNum = Number(rating);
    if (rating !== undefined && (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5))
      return res.status(400).json({ error: "التقييم غير صحيح" });
    if (gender !== undefined && !["male", "female"].includes(gender))
      return res.status(400).json({ error: "الجنس غير صحيح" });
    const review = await Review.create({ name: name.trim(), comment: comment.trim(), rating: ratingNum || 5, gender: gender || "male" });
    res.status(201).json({ success: true, _id: review._id });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/reviews/admin-add
router.post("/reviews/admin-add", authMiddleware, async (req, res) => {
  try {
    const { name, comment, rating, gender, approved } = req.body;
    if (!name || !comment) return res.status(400).json({ error: "الاسم والتعليق مطلوبان" });
    const review = await Review.create({ name, comment, rating: rating || 5, gender: gender || "male", approved: !!approved });
    invalidateReviewsCache();
    res.status(201).json(review);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/reviews/:id
router.put("/reviews/:id", authMiddleware, async (req, res) => {
  try {
    const { name, comment, rating, gender } = req.body;
    if (!name || !comment) return res.status(400).json({ error: "الاسم والتعليق مطلوبان" });
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { name, comment, rating: rating || 5, gender: gender || "male" },
      { new: true }
    );
    if (!review) return res.status(404).json({ error: "التعليق غير موجود" });
    invalidateReviewsCache();
    res.json(review);
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/reviews/:id/approve
router.patch("/reviews/:id/approve", authMiddleware, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, { approved: true }, { new: true });
    if (!review) return res.status(404).json({ error: "التعليق غير موجود" });
    invalidateReviewsCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PATCH /api/admin/reviews/:id/toggle
router.patch("/reviews/:id/toggle", authMiddleware, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: "التعليق غير موجود" });
    review.approved = !review.approved;
    await review.save();
    invalidateReviewsCache();
    res.json({ approved: review.approved });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/reviews/:id
router.delete("/reviews/:id", authMiddleware, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    invalidateReviewsCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
