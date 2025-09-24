// src/routes/upload.js
const express = require('express')
const multer = require('multer')
const path = require('path')
const mime = require('mime-types')
const sizeOf = require('image-size')
const { v2: cloudinary } = require('cloudinary')

const router = express.Router()

// ---- sanity check env ----
const requiredEnv = ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']
for (const k of requiredEnv) {
  if (!process.env[k]) {
    console.error(`[upload] Missing env ${k}`)
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 8)
const ALLOWED = (process.env.ALLOWED_IMAGE_MIME || 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif,image/svg+xml')
  .split(',').map(s => s.trim()).filter(Boolean)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${file.mimetype}`))
    }
    cb(null, true)
  }
})

router.post('/upload',
  // Multer middleware (note: errors from this go to the error handler below)
  upload.single('file'),

  // Your handler
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'file is required' })
      }

      // quick env guard
      for (const k of requiredEnv) {
        if (!process.env[k]) {
          return res.status(500).json({ error: `Server misconfigured: ${k} not set` })
        }
      }

      const folder = process.env.CLOUDINARY_FOLDER || 'uploads'
      let dims = {}
      try {
        // image-size supports Buffer; may throw for some formats -> guarded
        dims = sizeOf(req.file.buffer) || {}
      } catch (e) {
        // non-fatal
        console.warn('[upload] sizeOf failed:', e?.message)
      }

      // Cloudinary upload via stream
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            // 'auto' lets Cloudinary accept svg/heic/avif too
            resource_type: 'auto',
            // helpful naming options; optional
            use_filename: true,
            unique_filename: true,
            overwrite: false,
            // passing content type improves detection in some cases
            type: 'upload'
          },
          (err, r) => err ? reject(err) : resolve(r)
        )
        stream.on('error', (err) => {
          // this catches lower-level stream errors
          reject(err)
        })
        stream.end(req.file.buffer)
      })

      return res.json({
        url: result.secure_url,
        path: result.public_id,       // store this in DB if you want to delete later
        size: req.file.size,
        mime: req.file.mimetype,
        width: result.width || dims.width || null,
        height: result.height || dims.height || null,
        filename: (result.public_id || '').split('/').pop()
      })
    } catch (e) {
      // Log *full* error to server logs
      console.error('[upload] Error:', {
        name: e.name,
        message: e.message,
        http_code: e.http_code,
        stack: e.stack
      })
      // Surface a safe, useful payload
      return res.status(500).json({
        error: e.message || 'Upload failed',
        code: e.http_code || 500,
        details: e.name || 'Error'
      })
    }
  }
)

// Multer & general error handler for this router:
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer errors (size, fileFilter, etc.)
    const payload = { error: 'Upload error', code: err.code }
    if (err.code === 'LIMIT_FILE_SIZE') {
      payload.message = `File too large. Max ${MAX_UPLOAD_MB} MB.`
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      payload.message = err.message || 'Unsupported file type'
    } else {
      payload.message = err.message
    }
    console.warn('[upload] Multer error:', err)
    return res.status(400).json(payload)
  }
  // Anything else bubbles up
  next(err)
})

module.exports = router
