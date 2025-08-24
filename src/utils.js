const fs = require('fs')

function convoKey(a, b) {
  const [x, y] = [a, b].map(String).map(s => s.toUpperCase()).sort()
  return `${x}|${y}`
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  return p
}

module.exports = { convoKey, ensureDir }
