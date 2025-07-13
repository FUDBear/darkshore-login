// routes/auth.js
import express from 'express';
const router = express.Router();

router.get('/google', (req, res) => {
  res.send('Google login route works ✅');
});

export default router;
