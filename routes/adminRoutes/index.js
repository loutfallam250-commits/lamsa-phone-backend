const express = require("express");
const router = express.Router();

router.use(require("./auth"));
router.use(require("./company"));
router.use(require("./banners"));
router.use(require("./categories"));
router.use(require("./orders"));
router.use(require("./reviews"));
router.use(require("./products"));
router.use(require("./categoryBanners"));
router.use(require("./banks"));

module.exports = router;
