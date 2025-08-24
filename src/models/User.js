const mongoose = require('mongoose')

const UserSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  online: { type: Boolean, default: false },
}, { timestamps: true })

module.exports = mongoose.model('User', UserSchema)
