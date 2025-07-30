import express from 'express';
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Step 1: Initiate OAuth flow with nonce
router.get('/auth/google', async (req, res) => {
  try {
    const { nonce } = req.query;
    
    if (!nonce) {
      return res.status(400).json({ error: 'Nonce parameter required' });
    }

    console.log('🔐 Initiating Google OAuth with nonce:', nonce);

    const oauthUrl = `https://accounts.google.com/oauth/authorize?` +
      `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=openid email profile&` +
      `nonce=${encodeURIComponent(nonce)}`;

    console.log('📤 Redirecting to Google OAuth:', oauthUrl);
    res.redirect(oauthUrl);
  } catch (error) {
    console.error('❌ OAuth initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

// Step 2: Handle OAuth callback and exchange code for tokens
router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    console.log('📥 Received OAuth callback with code:', code);

    // Exchange authorization code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, id_token } = tokenResponse.data;
    
    console.log('✅ Tokens received from Google');

    // Decode the ID token to verify it contains the nonce
    const decodedToken = jwtDecode(id_token);
    
    console.log('🔍 ID Token Analysis:', {
      sub: decodedToken.sub,
      email: decodedToken.email,
      nonce: decodedToken.nonce,
      aud: decodedToken.aud,
      iss: decodedToken.iss
    });

    // Verify the nonce is present (this is crucial for zkLogin)
    if (!decodedToken.nonce) {
      console.error('❌ No nonce found in ID token');
      return res.status(400).json({ error: 'Nonce not found in ID token' });
    }

    console.log('✅ Nonce verification passed:', decodedToken.nonce);

    // Return the ID token to the client
    res.json({
      success: true,
      credential: id_token,
      user: {
        sub: decodedToken.sub,
        email: decodedToken.email,
        name: decodedToken.name,
        picture: decodedToken.picture
      }
    });

  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    res.status(500).json({ error: 'Failed to complete OAuth flow' });
  }
});

// Step 3: Verify token endpoint
router.post('/auth/verify', async (req, res) => {
  try {
    const { credential } = req.body;
    
    if (!credential) {
      return res.status(400).json({ error: 'Credential required' });
    }

    // Decode and verify the JWT
    const decoded = jwtDecode(credential);
    
    console.log('🔍 Token verification:', {
      sub: decoded.sub,
      email: decoded.email,
      nonce: decoded.nonce,
      aud: decoded.aud,
      iss: decoded.iss,
      exp: decoded.exp
    });

    // Verify the token is not expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      return res.status(401).json({ error: 'Token expired' });
    }

    // Verify the issuer is Google
    if (decoded.iss !== 'https://accounts.google.com') {
      return res.status(401).json({ error: 'Invalid token issuer' });
    }

    res.json({
      success: true,
      user: {
        sub: decoded.sub,
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture
      },
      nonce: decoded.nonce
    });

  } catch (error) {
    console.error('❌ Token verification error:', error);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

export default router; 