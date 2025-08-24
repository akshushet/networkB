// src/routes/upload.js
const express = require('express')
const multer = require('multer')
const path = require('path')
const mime = require('mime-types')
const sizeOf = require('image-size')
const { v2: cloudinary } = require('cloudinary')
const { ensureDir } = require('../utils')

const router = express.Router()

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 8)
const ALLOWED = (process.env.ALLOWED_IMAGE_MIME || 'image/jpeg,image/png,image/webp,image/gif')
  .split(',').map(s => s.trim()).filter(Boolean)

const uploadDir = ensureDir(path.join(__dirname, '..', '..', 'uploads'))

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).replace('.', '') || 'bin'
    const safe = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext
    cb(null, safe)
  }
})

function fileFilter(req, file, cb) {
  if (!ALLOWED.includes(file.mimetype)) return cb(new Error('Unsupported file type: ' + file.mimetype))
  cb(null, true)
}

// const upload = multer({
//   storage,
//   fileFilter,
//   limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
// })
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED.includes(file.mimetype)) return cb(new Error('Unsupported file type: ' + file.mimetype))
    cb(null, true)
  }
})

// router.post('/upload', upload.single('file'), async (req, res) => {
//   try {
//     const f = req.file
//     if (!f) return res.status(400).json({ error: 'file is required' })
//     let dim = {}
//     try { dim = sizeOf(f.path) || {} } catch {}
//     const url = `${req.protocol}://${req.get('host')}/uploads/${f.filename}`
//     res.json({
//       url,
//       path: `/uploads/${f.filename}`,
//       size: f.size,
//       mime: f.mimetype,
//       width: dim.width || null,
//       height: dim.height || null,
//       filename: f.filename
//     })
//   } catch (e) {
//     res.status(500).json({ error: e.message })
//   }
// })

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' })
    const folder = process.env.CLOUDINARY_FOLDER || 'uploads'
    const dims = (() => { try { return sizeOf(req.file.buffer) } catch { return {} } })()

    // upload via stream (buffer)
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (err, r) => err ? reject(err) : resolve(r)
      )
      stream.end(req.file.buffer)
    })

    // result.secure_url is the public https URL
    res.json({
      url: result.secure_url,
      path: result.public_id,
      size: req.file.size,
      mime: req.file.mimetype,
      width: result.width || dims.width || null,
      height: result.height || dims.height || null,
      filename: result.public_id.split('/').pop()
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// module.exports = router
module.exports = router
