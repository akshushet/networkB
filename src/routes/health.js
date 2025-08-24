const express = require('express')
const router = express.Router()

router.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), now: Date.now() })
})

module.exports = router
