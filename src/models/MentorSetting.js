const mongoose = require('mongoose');

const mentorSettingSchema = new mongoose.Schema(
  {
    mentorId: { type: String, required: true, unique: true },
    recordingMode: { type: String, enum: ['off', 'on_consent'], default: 'off' },
    fileSharing: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MentorSetting', mentorSettingSchema);