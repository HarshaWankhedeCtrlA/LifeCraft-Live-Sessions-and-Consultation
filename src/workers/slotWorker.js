const Availability = require('../models/Availability');
const { generateForMentor } = require('../services/slotGenerator');

// Keeps every mentor's calendar filled out to their horizon
exports.topUpSlots = async () => {
  let mentors = 0;
  for await (const a of Availability.find({ isActive: true, 'windows.0': { $exists: true } })) {
    await generateForMentor(a);
    mentors++;
  }
  return { mentors };
};