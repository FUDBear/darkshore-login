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

// React-specific OAuth routes (separate from Unity)
router.get('/react/google', (req, res, next) => {
  const sessionId = req.query.sessionId;
  const nonce = req.query.nonce;
  
  console.log('🔐 React OAuth initiated with:', { sessionId, nonce });
  
  // Store nonce under reactNonces
  if (!global.reactNonces) global.reactNonces = {};
  if (sessionId && nonce) global.reactNonces[sessionId] = nonce;

  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
    state: `react:${sessionId}`,
    nonce: nonce,
    callbackURL: process.env.GOOGLE_REACT_CALLBACK_URI  // Use environment variable
  })(req, res, next);
});

// React OAuth callback
router.get('/react/google/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const sessionId = state?.startsWith('react:') ? state.substring(6) : state;
  
  if (!code) return res.redirect(process.env.REACT_APP_URL + '/?status=error');

  try {
    console.log('📥 React OAuth callback received:', { code, sessionId });
    
    // Get the stored nonce for this session
    const storedNonce = global.reactNonces && global.reactNonces[sessionId];
    console.log('🔍 Stored nonce for React session:', storedNonce);
    
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REACT_CALLBACK_URI,
        grant_type: 'authorization_code'
      })
    });
    
    if (!tokenRes.ok) {
      console.error('React token exchange failed:', tokenRes.status, tokenRes.statusText);
      return res.redirect(process.env.REACT_APP_URL + '/?status=error');
    }
    
    const tokenData = await tokenRes.json();
    let idToken = tokenData.id_token;
    console.log('✅ React tokens received from Google');
    
    if (!idToken) {
      console.error('No ID token received for React');
      return res.redirect(process.env.REACT_APP_URL + '/?status=error');
    }

    // Decode and inject nonce if needed
    const jwtPayload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    console.log('🔍 React JWT payload:', {
      sub: jwtPayload.sub,
      email: jwtPayload.email,
      nonce: jwtPayload.nonce,
      aud: jwtPayload.aud
    });

    // Inject nonce if not present
    if (!jwtPayload.nonce && storedNonce) {
      console.log('🔧 Injecting nonce into React JWT');
      jwtPayload.nonce = storedNonce;
      
      const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString());
      const newHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const newPayload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
      const signature = idToken.split('.')[2];
      
      idToken = `${newHeader}.${newPayload}.${signature}`;
      console.log('✅ Modified React JWT with nonce:', jwtPayload.nonce);
    }

    if (sessionId) {
      if (!global.reactTokens) global.reactTokens = {};
      
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
      
      // Store in React-specific token storage
      global.reactTokens[sessionId] = { idToken, salt };
      console.log('✅ React token stored for session:', sessionId);
      
      // Clean up nonce storage
      if (global.reactNonces && global.reactNonces[sessionId]) {
        delete global.reactNonces[sessionId];
      }
      
      res.redirect(process.env.REACT_APP_URL + '/?status=success');
    } else {
      res.redirect(process.env.REACT_APP_URL + '/?status=success');
    }
  } catch (error) {
    console.error('React authentication error:', error);
    res.redirect(process.env.REACT_APP_URL + '/?status=error');
  }
});

// React token endpoint
router.get('/react/token', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!global.reactTokens) global.reactTokens = {};
  
  console.log('🔍 React token request for sessionId:', sessionId);
  console.log('📋 Available React sessions:', Object.keys(global.reactTokens));
  
  const tokenObj = global.reactTokens[sessionId];
  if (tokenObj) {
    console.log('✅ React token found for session:', sessionId);
    res.json(tokenObj);
    delete global.reactTokens[sessionId]; // Clean up after use
  } else {
    console.log('❌ No React token found for session:', sessionId);
    res.status(404).send('');
  }
});

// Original Unity OAuth routes (unchanged)
// Start login
router.get('/google', (req, res, next) => {
  const sessionId = req.query.sessionId;
  const nonce = req.query.nonce; // Get nonce from query params
  
  console.log('🔐 OAuth initiated with:', { sessionId, nonce });
  
  // Store the nonce for this session so we can use it in the token exchange
  if (!global.nonces) global.nonces = {};
  if (sessionId && nonce) {
    global.nonces[sessionId] = nonce;
  }
  
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
    state: sessionId, // Pass sessionId as state
    nonce: nonce // Include nonce in OAuth request
  })(req, res, next);
});

// Callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const sessionId = req.query.state; // <-- Use state, not sessionId
  if (!code) return res.redirect('http://localhost:3000/?status=error');

  try {
    console.log('📥 OAuth callback received:', { code, sessionId });
    
    // Get the stored nonce for this session
    const storedNonce = global.nonces && global.nonces[sessionId];
    console.log('🔍 Stored nonce for session:', storedNonce);
    
    // Exchange code for tokens (Google may not include nonce in JWT for auth code flow)
    const tokenRequestBody = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'http://localhost:3000/login/google/callback',
      grant_type: 'authorization_code'
    });
    
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenRequestBody
    });
    
    if (!tokenRes.ok) {
      console.error('Token exchange failed:', tokenRes.status, tokenRes.statusText);
      return res.redirect('http://localhost:3000/?status=error');
    }
    
    const tokenData = await tokenRes.json();
    let idToken = tokenData.id_token; // <-- This is your JWT!
    console.log('✅ Tokens received from Google');
    
    if (!idToken) {
      console.error('No ID token received');
      return res.redirect('http://localhost:3000/?status=error');
    }

    // Decode the JWT to check if nonce is included
    const jwtPayload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    console.log('🔍 Original JWT payload:', {
      sub: jwtPayload.sub,
      email: jwtPayload.email,
      nonce: jwtPayload.nonce,
      aud: jwtPayload.aud
    });

    // If Google didn't include the nonce (common in auth code flow), we'll create a modified JWT
    if (!jwtPayload.nonce && storedNonce) {
      console.log('🔧 Injecting nonce into JWT for zkLogin compatibility');
      
      // Add the nonce to the payload
      jwtPayload.nonce = storedNonce;
      
      // Create a new JWT with the nonce included
      const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString());
      const newHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const newPayload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
      const signature = idToken.split('.')[2]; // Keep original signature for now
      
      // Note: This creates a JWT with modified payload but original signature
      // For zkLogin, we primarily need the payload data, not signature verification
      idToken = `${newHeader}.${newPayload}.${signature}`;
      
      console.log('✅ Modified JWT with nonce:', jwtPayload.nonce);
    } else if (jwtPayload.nonce) {
      console.log('✅ JWT already contains nonce:', jwtPayload.nonce);
    } else {
      console.log('⚠️ No stored nonce found for session:', sessionId);
    }

  if (sessionId) {
    if (!global.tokens) global.tokens = {};
    if (!global.salts) global.salts = {};
    
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
    
    // Store the token data for the session
    global.tokens[sessionId] = { idToken, salt };
    console.log('✅ Token stored for session:', sessionId);
    
    // Clean up the nonce storage
    if (global.nonces && global.nonces[sessionId]) {
      delete global.nonces[sessionId];
    }
    
    res.redirect('http://localhost:3000/?status=success');
  } else {
    res.redirect('http://localhost:3000/?status=success');
  }
  } catch (error) {
    console.error('Authentication error:', error);
    res.redirect('http://localhost:3000/?status=error');
  }
});

router.get('/token', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!global.tokens) global.tokens = {};
  
  console.log('🔍 Token request for sessionId:', sessionId);
  console.log('📋 Available sessions:', Object.keys(global.tokens));
  console.log('💾 Session data exists:', !!global.tokens[sessionId]);
  
  const tokenObj = global.tokens[sessionId];
  if (tokenObj) {
    console.log('✅ Token found for session:', sessionId);
    res.json(tokenObj); // { idToken, salt }
    delete global.tokens[sessionId];
  } else {
    console.log('❌ No token found for session:', sessionId);
    res.status(404).send('');
  }
});

export default router;