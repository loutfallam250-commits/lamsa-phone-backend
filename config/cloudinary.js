const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { Readable } = require("stream");
const sharp = require("sharp");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const memoryStorage = multer.memoryStorage();

function makeImageUpload() {
  return multer({ storage: memoryStorage, limits: { fileSize: 5 * 1024 * 1024 } });
}

function makeFileUpload() {
  return multer({ storage: memoryStorage, limits: { fileSize: 20 * 1024 * 1024 } });
}

/**
 * Resize + convert to WebP before uploading to Cloudinary.
 * - Max width: 1600px (banners are never rendered wider than that)
 * - Quality: 82 — good visual quality, roughly 50–70% smaller than the original
 * - withoutEnlargement: never upscale a small image
 * Returns a Buffer ready to pipe to Cloudinary.
 */
async function optimizeImage(buffer, { maxWidth = 1600, quality = 82 } = {}) {
  return sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

async function uploadToCloudinary(buffer, folder, options = {}) {
  // Optimise the image before sending to Cloudinary
  const optimized = await optimizeImage(buffer);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, format: "webp", ...options },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    Readable.from(optimized).pipe(stream);
  });
}

async function deleteFromCloudinary(url, resource_type = "image") {
  if (!url || !url.includes("cloudinary.com")) return;
  try {
    const parts = url.split("/");
    const uploadIndex = parts.indexOf("upload");
    let pathParts = parts.slice(uploadIndex + 1);
    if (/^v\d+$/.test(pathParts[0])) pathParts = pathParts.slice(1);
    const publicId = pathParts.join("/").replace(/\.[^/.]+$/, "");
    await cloudinary.uploader.destroy(publicId, { resource_type });
  } catch (e) {
    console.error("Cloudinary delete error:", e.message);
  }
}

module.exports = { cloudinary, makeImageUpload, makeFileUpload, uploadToCloudinary, deleteFromCloudinary };
