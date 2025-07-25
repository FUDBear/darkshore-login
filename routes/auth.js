import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
router.get('/google', (req, res, next) => {
  const sessionId = req.query.sessionId;
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
    state: sessionId // Pass sessionId as state
  })(req, res, next);
});

// Callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const sessionId = req.query.state; // <-- Use state, not sessionId
  if (!code) return res.redirect('/?status=error');

  try {
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
    
    if (!tokenRes.ok) {
      console.error('Token exchange failed:', tokenRes.status, tokenRes.statusText);
      return res.redirect('/?status=error');
    }
    
    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token; // <-- This is your JWT!
    console.log('Google token response:', tokenData);
    
    if (!idToken) {
      console.error('No ID token received');
      return res.redirect('/?status=error');
    }

  if (sessionId) {
    if (!global.tokens) global.tokens = {};
    if (!global.salts) global.salts = {};
    const jwtPayload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    const sub = jwtPayload.sub;
    const { data, error } = await supabase
      .from('salts')
      .select('salt')
      .eq('google_sub', sub)
      .single();

    let salt;
    if (data) {
      salt = data.salt;
    } else {
      salt = crypto.randomInt(1e13, 281474976710655).toString();
      await supabase.from('salts').insert([{ google_sub: sub, salt }]);
    }
    global.tokens[sessionId] = { idToken, salt };
    res.redirect('/?status=success');
  } else {
    res.redirect('/?status=success');
  }
  } catch (error) {
    console.error('Authentication error:', error);
    res.redirect('/?status=error');
  }
});

router.get('/token', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!global.tokens) global.tokens = {};
  console.log('Polling for sessionId:', sessionId, 'Available tokens:', Object.keys(global.tokens));
  const tokenObj = global.tokens[sessionId];
  if (tokenObj) {
    res.json(tokenObj); // { idToken, salt }
    delete global.tokens[sessionId];
  } else {
    res.status(404).send('');
  }
});

export default router;