const rateLimit = require("express-rate-limit");

const orderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, error: "طلبات كثيرة، حاول لاحقاً" },
});

module.exports = { orderRateLimit };
