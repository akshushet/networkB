// src/routes/upload.js
const express = require('express')
const multer = require('multer')
const path = require('path')
const mime = require('mime-types')
const sizeOf = require('image-size')
const { v2: cloudinary } = require('cloudinary')
const sharp = require('sharp') // <-- NEW
const router = express.Router()

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 8)
const ALLOWED = (process.env.ALLOWED_IMAGE_MIME || 'image/jpeg,image/png,image/webp,image/gif')
  .split(',').map(s => s.trim()).filter(Boolean)

// Compression controls (override via env if you like)
const MAX_IMAGE_DIM   = Number(process.env.MAX_IMAGE_DIM || 2560) // px (longer side)
const OUTPUT_FORMAT   = (process.env.OUTPUT_FORMAT || 'webp').toLowerCase() // 'webp' | 'avif' | 'original'
const WEBP_QUALITY    = Number(process.env.WEBP_QUALITY || 82)   // 1..100
const AVIF_QUALITY    = Number(process.env.AVIF_QUALITY || 45)   // 1..100
const CLOUD_FOLDER    = process.env.CLOUDINARY_FOLDER || 'uploads'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED.includes(file.mimetype)) return cb(new Error('Unsupported file type: ' + file.mimetype))
    cb(null, true)
  }
})

async function compressImage(inputBuffer, mimetype) {
  // Skip compression for animated GIFs (sharp will only read first frame)
  // We'll just pass-through in that case.
  if (mimetype === 'image/gif') {
    // Try to detect animation frames; if animated, skip re-encode
    try {
      const meta = await sharp(inputBuffer, { limitInputPixels: false }).metadata()
      if ((meta.pages || 1) > 1) {
        return { buffer: inputBuffer, mime: 'image/gif', width: meta.width, height: meta.height, ext: 'gif' }
      }
    } catch { /* ignore and fall through */ }
  }

  // Read metadata and rotate per EXIF
  const base = sharp(inputBuffer, { limitInputPixels: false }).rotate()
  const meta = await base.metadata()

  // Resize to fit within MAX_IMAGE_DIM (keeps aspect; no upscaling)
  let pipe = base.resize({
    width:  meta.width  && meta.width  > MAX_IMAGE_DIM ? MAX_IMAGE_DIM : undefined,
    height: meta.height && meta.height > MAX_IMAGE_DIM ? MAX_IMAGE_DIM : undefined,
    fit: 'inside',
    withoutEnlargement: true
  })

  // Decide target encoding
  let targetMime = mimetype
  let ext = mime.extension(mimetype)

  if (OUTPUT_FORMAT === 'original') {
    // Keep original container but still benefit from resize/EXIF fix
    // Optionally, you could choose jpeg/webp for jpegs to reduce size further.
    if (mimetype === 'image/jpeg') {
      pipe = pipe.jpeg({ quality: 82, mozjpeg: true })
      targetMime = 'image/jpeg'; ext = 'jpg'
    } else if (mimetype === 'image/png') {
      // Lossless-ish PNG optimization; consider converting PNG->WEBP for photos
      pipe = pipe.png({ compressionLevel: 9, palette: true })
      targetMime = 'image/png'; ext = 'png'
    } else if (mimetype === 'image/webp') {
      pipe = pipe.webp({ quality: WEBP_QUALITY })
      targetMime = 'image/webp'; ext = 'webp'
    } else {
      // Fallback: just output buffer as-is
      return { buffer: await pipe.toBuffer(), mime: mimetype, width: meta.width, height: meta.height, ext }
    }
  } else if (OUTPUT_FORMAT === 'avif') {
    pipe = pipe.avif({ quality: AVIF_QUALITY })
    targetMime = 'image/avif'; ext = 'avif'
  } else {
    // default: webp
    // nearLossless helps for graphics/PNGs
    const nearLossless = (meta.format === 'png')
    pipe = pipe.webp({ quality: WEBP_QUALITY, nearLossless })
    targetMime = 'image/webp'; ext = 'webp'
  }

  const out = await pipe.toBuffer()
  const dims = sizeOf(out) // quick read on output
  return { buffer: out, mime: targetMime, width: dims.width, height: dims.height, ext }
}

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' })

    // Compress first
    const { buffer: compressed, mime: outMime, width, height, ext } =
      await compressImage(req.file.buffer, req.file.mimetype)

    // Upload compressed buffer to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: CLOUD_FOLDER,
          resource_type: 'image',
          // Let Cloudinary store as our encoded format
          format: ext,
          // If you'd like a deterministic public_id:
          // public_id: Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        },
        (err, r) => err ? reject(err) : resolve(r)
      )
      stream.end(compressed)
    })

    // Also provide an optimized delivery URL (q_auto,f_auto)
    const optimizedUrl = cloudinary.url(result.public_id, {
      secure: true,
      transformation: [{ quality: 'auto', fetch_format: 'auto' }]
    })

    res.json({
      url: result.secure_url,          // uploaded (compressed) asset
      optimizedUrl,                    // delivery-optimized URL for clients
      path: result.public_id,
      size: compressed.length,         // compressed size in bytes
      mime: outMime,                   // compressed mime
      width: result.width || width || null,
      height: result.height || height || null,
      filename: result.public_id.split('/').pop()
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
