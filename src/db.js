const mongoose = require('mongoose')

async function connect(mongoUrl) {
  if (!mongoUrl) throw new Error('MONGO_URL missing — .env not loaded or empty')
  mongoose.set('strictQuery', true)
  const opts = {
    serverSelectionTimeoutMS: 20000,
    family: 4, // prefer IPv4 (Windows-friendly)
  }
  if (String(process.env.MONGO_TLS_ALLOW_INVALID).toLowerCase() === 'true') {
    opts.tlsAllowInvalidCertificates = true
    opts.tlsAllowInvalidHostnames = true
  }
  const conn = await mongoose.connect(mongoUrl, opts)
  mongoose.connection.on('error', (err) => console.error('[mongo] error:', err?.message))
  mongoose.connection.once('open', () => {
    console.log('[mongo] host:', mongoose.connection.host, 'db:', mongoose.connection.name)
  })
  return conn.connection
}

module.exports = { connect }
