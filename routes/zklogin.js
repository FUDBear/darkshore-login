import express from 'express';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { jwtDecode } from 'jwt-decode';
import { getZkLoginSignature, jwtToAddress } from '@mysten/sui/zklogin';

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import axios from 'axios'; // Added axios for ZK proving service call

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const router = express.Router();

// zkLogin proof generation endpoint
router.post('/v1/zklogin', async (req, res) => {
  try {
    const { credential, randomness, audience, ephemeralPublicKey, maxEpoch } = req.body;
    
    // Decode the JWT to get the user's Google 'sub' ID
    const decodedJwt = jwtDecode(credential);
    const sub = decodedJwt.sub;

    if (!sub) {
      return res.status(400).json({ error: "Missing 'sub' claim in JWT" });
    }

    // Get or create the user's salt from Supabase (stored as hex)
    const { data: saltData, error: saltError } = await supabase
      .from('salts')
      .select('salt')
      .eq('google_sub', sub)
      .single();

    let salt; // Salt is in hex format
    if (saltData) {
      salt = saltData.salt;
      console.log(`🧂 Salt retrieved for user ${sub}`);
    } else if (!saltError || saltError.code === 'PGRST116') {
      salt = crypto.randomBytes(16).toString('hex');
      const { error: insertError } = await supabase.from('salts').insert([{ google_sub: sub, salt }]);
      if (insertError) {
        throw new Error(`Failed to insert new salt: ${insertError.message}`);
      }
      console.log(`🧂 New salt created and stored for user ${sub}`);
    } else {
      throw new Error(`Failed to query for salt: ${saltError.message}`);
    }

    // Generate the user's zkLogin address
    const zkLoginAddress = jwtToAddress(credential, salt);
    
    console.log('🔍 Address Generation Debug:');
    console.log('  Salt (hex):', salt);
    console.log('  Generated Address:', zkLoginAddress);

    // The ZK Proving Service requires the salt to be Base64 encoded
    const saltAsBase64 = Buffer.from(salt, 'hex').toString('base64');

    // Call the ZK Proving Service for a real proof
    console.log('📞 Calling ZK proving service...');
    try {
      const payload = {
        jwt: credential,
        extendedEphemeralPublicKey: ephemeralPublicKey,
        maxEpoch: maxEpoch,
        jwtRandomness: randomness,
        salt: saltAsBase64,
        keyClaimName: 'sub'
      };
      
      const proverResponse = await axios.post('https://prover-dev.mystenlabs.com/v1', payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      const realProof = proverResponse.data;
      console.log('✅ Real ZK proof received from service.');
      
      // Update the player's zklogin_address in the database
      const { error: updateError } = await supabase
        .from('players')
        .update({ zklogin_address: zkLoginAddress, last_login: new Date().toISOString() })
        .eq('google_sub', sub);

      if (updateError) {
        console.error('Error updating zklogin_address:', updateError);
      }

      // Return the real proof and address. 
      // CRITICAL: Return the salt in HEX format for the frontend.
      res.json({
        proof: realProof,
        address: zkLoginAddress,
        salt: salt, // Return the hex salt
      });

    } catch (proverError) {
      console.error('❌ Error calling ZK proving service.');
      if (proverError.response) {
        console.error('  Status:', proverError.response.status);
        console.error('  Data:', proverError.response.data);
      } else {
        console.error('  Message:', proverError.message);
      }
      return res.status(500).json({ 
        error: 'Failed to generate real ZK proof',
        details: proverError.response ? proverError.response.data : proverError.message,
      });
    }
  } catch (error) {
    console.error('zkLogin proof generation error:', error);
    res.status(500).json({ error: 'Failed to generate zkLogin proof' });
  }
});

// Step 4: Transaction signing endpoint (for client-side use)
router.post('/v1/zklogin/sign', async (req, res) => {
  try {
    const { transaction, ephemeralPrivateKey, proof, address } = req.body;
    
    if (!transaction || !ephemeralPrivateKey || !proof || !address) {
      return res.status(400).json({ 
        error: 'Missing required parameters: transaction, ephemeralPrivateKey, proof, address' 
      });
    }

    // Create ephemeral keypair from private key
    const ephemeralKeypair = Ed25519Keypair.fromSecretKey(
      new Uint8Array(ephemeralPrivateKey)
    );

    // Sign the transaction with the ephemeral private key
    const signature = await ephemeralKeypair.signTransactionBlock(transaction);

    // Return the signed transaction with zkLogin proof
    res.json({
      signedTransaction: {
        ...transaction,
        signature: signature
      },
      proof: proof,
      address: address
    });
  } catch (error) {
    console.error('zkLogin transaction signing error:', error);
    res.status(500).json({ error: 'Failed to sign zkLogin transaction' });
  }
});

// Step 5: Transaction submission endpoint
router.post('/v1/zklogin/submit', async (req, res) => {
  try {
    const { signedTransaction, proof, address } = req.body;
    
    console.log('📥 Transaction submission received:', {
      hasSignedTransaction: !!signedTransaction,
      hasProof: !!proof,
      hasAddress: !!address,
      address: address
    });
    
    if (!signedTransaction || !proof || !address) {
      console.error('❌ Missing required parameters for transaction submission');
      return res.status(400).json({ 
        error: 'Missing required parameters: signedTransaction, proof, address' 
      });
    }

    // For development purposes, we'll simulate a successful transaction
    // In production, you would submit to the actual Sui network
    console.log('🔄 Processing mock transaction submission...');
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Generate a mock transaction digest
    const mockDigest = '0x' + Math.random().toString(16).substr(2, 64);
    
    console.log('✅ Mock transaction submitted successfully');
    res.json({
      success: true,
      transactionDigest: mockDigest,
      effects: {
        status: { status: 'success' },
        gasUsed: { computationCost: 1000, storageCost: 100, storageRebate: 50 }
      },
      objectChanges: [
        {
          type: 'transferred',
          sender: address,
          recipient: address,
          objectId: '0x' + Math.random().toString(16).substr(2, 40)
        }
      ]
    });
  } catch (error) {
    console.error('❌ Transaction submission error:', error);
    res.status(500).json({ error: 'Failed to submit zkLogin transaction' });
  }
});

export default router; 