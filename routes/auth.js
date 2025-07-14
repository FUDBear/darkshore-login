import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const router = express.Router();

// Store id_token per session (for single-user flows)
let lastIdToken = null;

const strategy = new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/login/google/callback'
  },
  function(accessToken, refreshToken, profile, cb, params) {
    console.log('params:', params); // <-- id_token may be here
    return cb(null, { profile, accessToken, idToken: params && params.id_token });
  }
);

passport.use(strategy);

// Start login
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email', 'openid'] }));

// Callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const sessionId = req.query.sessionId;
  if (!code) return res.status(400).send('Missing code');

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'http://localhost:3000/login/google/callback',
      grant_type: 'authorization_code'
    })
  });
  const tokenData = await tokenRes.json();
  const idToken = tokenData.id_token; // <-- This is your JWT!
  console.log('Google token response:', tokenData);

  if (sessionId) {
    if (!global.tokens) global.tokens = {};
    global.tokens[sessionId] = idToken;
    res.send('Google login route works ✅');
  } else {
    res.send(`Your JWT: ${idToken}`);
  }
});

export default router;