const express = require("express");
const router = express.Router();
const { getProducts, getProduct, createProduct, updateProduct, deleteProduct, getProductsByCategory } = require("../controllers/productController");
const { authMiddleware } = require("./adminRoutes/middleware");

router.route("/").get(getProducts);
router.get("/by-category", getProductsByCategory);
router.post("/", authMiddleware, createProduct);
router.route("/:id").get(getProduct);
router.put("/:id", authMiddleware, updateProduct);
router.delete("/:id", authMiddleware, deleteProduct);

module.exports = router;
