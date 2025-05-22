const mongoose = require('mongoose');

const SensitiveImageSchema = new mongoose.Schema({
  imageId: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ['Sensitive', 'Not Sensitive'],
    required: true,
  },
  markedAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model('SensitiveImage', SensitiveImageSchema);