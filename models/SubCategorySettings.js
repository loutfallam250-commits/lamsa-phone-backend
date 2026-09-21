const mongoose = require("mongoose");

const subCategorySettingsSchema = new mongoose.Schema({
  category: { type: String, required: true },
  subCategory: { type: String, required: true },
  showInHome: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  image: { type: String, default: "" },
});

subCategorySettingsSchema.index({ category: 1, subCategory: 1 }, { unique: true });
// [PERF] Speeds up home-settings queries that filter/sort by showInHome + order
subCategorySettingsSchema.index({ showInHome: 1, order: 1 });

module.exports = mongoose.model("SubCategorySettings", subCategorySettingsSchema);
