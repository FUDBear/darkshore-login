import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const router = express.Router();

// Initialize player
router.post('/init', async (req, res) => {
  try {
    const { googleSub } = req.body;
    
    if (!googleSub) {
      return res.status(400).json({ error: 'googleSub is required' });
    }

    // Check if player already exists
    const { data: existingPlayer, error: fetchError } = await supabase
      .from('players')
      .select('*')
      .eq('google_sub', googleSub)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching player:', fetchError);
      return res.status(500).json({ error: 'Database error' });
    }

    let playerData;
    
    if (existingPlayer) {
      // Player exists, return current state
      playerData = existingPlayer;
    } else {
      // Create new player with default values matching your schema
      const newPlayer = {
        google_sub: googleSub,
        active_hand: [-1, -1, -1], // Default 3 cards as per schema
        hand: [],
        deck_count: 20, // Default 20 as per schema
        deck: [],
        reset_deck: true, // Default true as per schema
        madness: 0,
        state: 1, // Default 1 as per schema
        casts: 0,
        catch: null,
        utc_timestamp: Math.floor(Date.now()), // Unix timestamp in milliseconds
        last_login: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('players')
        .insert([newPlayer])
        .select()
        .single();

      if (error) {
        console.error('Error creating player:', error);
        return res.status(500).json({ error: 'Failed to create player' });
      }

      playerData = data;
    }

    res.json({ state: playerData });
  } catch (error) {
    console.error('Player initialization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get player state
router.get('/state/:googleSub', async (req, res) => {
  try {
    const { googleSub } = req.params;
    
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('google_sub', googleSub)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Player not found' });
      }
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({ state: data });
  } catch (error) {
    console.error('Get player state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update player state
router.put('/state/:googleSub', async (req, res) => {
  try {
    const { googleSub } = req.params;
    const updateData = req.body;
    
    const { data, error } = await supabase
      .from('players')
      .update({
        ...updateData,
        utc_timestamp: new Date().toISOString()
      })
      .eq('google_sub', googleSub)
      .select()
      .single();

    if (error) {
      console.error('Error updating player:', error);
      return res.status(500).json({ error: 'Failed to update player' });
    }

    res.json({ state: data });
  } catch (error) {
    console.error('Update player state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sync player's NFT holdings
router.post('/sync-nfts', async (req, res) => {
  try {
    const { googleSub, walletAddress, nftHoldings } = req.body;
    
    if (!googleSub) {
      return res.status(400).json({ error: 'googleSub is required' });
    }

    // Update player's NFT holdings
    const { data, error } = await supabase
      .from('players')
      .update({
        nft_holdings: {
          wallet_address: walletAddress,
          ...nftHoldings
        },
        utc_timestamp: Math.floor(Date.now())
      })
      .eq('google_sub', googleSub)
      .select()
      .single();

    if (error) {
      console.error('Error syncing NFT holdings:', error);
      return res.status(500).json({ error: 'Failed to sync NFT holdings' });
    }

    res.json({ success: true, player: data });
  } catch (error) {
    console.error('NFT sync error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add card to deck in database
router.post('/add-deck-card', async (req, res) => {
  try {
    const { googleSub, deckObjectId, cardObjectId, cardData } = req.body;
    
    if (!googleSub || !deckObjectId || !cardObjectId) {
      return res.status(400).json({ error: 'googleSub, deckObjectId, and cardObjectId are required' });
    }

    // Get current player data
    const { data: player, error: fetchError } = await supabase
      .from('players')
      .select('nft_holdings')
      .eq('google_sub', googleSub)
      .single();

    if (fetchError) {
      console.error('Error fetching player for deck update:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch player data' });
    }

    // Initialize nft_holdings if it doesn't exist
    let nftHoldings = player.nft_holdings || { decks: [], standalone_cards: [] };
    
    // Ensure arrays exist
    if (!nftHoldings.decks) nftHoldings.decks = [];
    if (!nftHoldings.standalone_cards) nftHoldings.standalone_cards = [];

    // Find and update the deck
    const deckIndex = nftHoldings.decks.findIndex(deck => deck.object_id === deckObjectId);
    if (deckIndex !== -1) {
      if (!nftHoldings.decks[deckIndex].cards) {
        nftHoldings.decks[deckIndex].cards = [];
      }
      
      // Add card to deck (avoid duplicates)
      const existingCardIndex = nftHoldings.decks[deckIndex].cards.findIndex(
        card => card.object_id === cardObjectId
      );
      if (existingCardIndex === -1) {
        nftHoldings.decks[deckIndex].cards.push(cardData);
      }
    }

    // Remove card from standalone_cards if it exists there
    nftHoldings.standalone_cards = nftHoldings.standalone_cards.filter(
      card => card.objectId !== cardObjectId && card.object_id !== cardObjectId
    );

    // Update the database
    const { data, error } = await supabase
      .from('players')
      .update({
        nft_holdings: nftHoldings,
        utc_timestamp: Math.floor(Date.now())
      })
      .eq('google_sub', googleSub)
      .select()
      .single();

    if (error) {
      console.error('Error adding card to deck:', error);
      return res.status(500).json({ error: 'Failed to add card to deck' });
    }

    console.log(`✅ Card ${cardObjectId} added to deck ${deckObjectId} for player ${googleSub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Add deck card error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove card from deck in database
router.post('/remove-deck-card', async (req, res) => {
  try {
    const { googleSub, deckObjectId, cardObjectId } = req.body;
    
    if (!googleSub || !deckObjectId || !cardObjectId) {
      return res.status(400).json({ error: 'googleSub, deckObjectId, and cardObjectId are required' });
    }

    // Get current player data
    const { data: player, error: fetchError } = await supabase
      .from('players')
      .select('nft_holdings')
      .eq('google_sub', googleSub)
      .single();

    if (fetchError) {
      console.error('Error fetching player for deck update:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch player data' });
    }

    // Initialize nft_holdings if it doesn't exist
    let nftHoldings = player.nft_holdings || { decks: [], standalone_cards: [] };
    
    // Ensure arrays exist
    if (!nftHoldings.decks) nftHoldings.decks = [];
    if (!nftHoldings.standalone_cards) nftHoldings.standalone_cards = [];

    // Find the deck and remove the card
    const deckIndex = nftHoldings.decks.findIndex(deck => deck.object_id === deckObjectId);
    let removedCard = null;
    
    if (deckIndex !== -1 && nftHoldings.decks[deckIndex].cards) {
      // Find and remove the card from the deck
      const cardIndex = nftHoldings.decks[deckIndex].cards.findIndex(
        card => card.object_id === cardObjectId
      );
      
      if (cardIndex !== -1) {
        // Store the removed card data
        removedCard = nftHoldings.decks[deckIndex].cards[cardIndex];
        // Remove the card from the deck
        nftHoldings.decks[deckIndex].cards.splice(cardIndex, 1);
      }
    }

    // If we found and removed a card, add it back to standalone_cards
    if (removedCard) {
      // Check if card already exists in standalone_cards (avoid duplicates)
      const existsInStandalone = nftHoldings.standalone_cards.some(
        card => (card.object_id === cardObjectId || card.objectId === cardObjectId)
      );
      
      if (!existsInStandalone) {
        nftHoldings.standalone_cards.push(removedCard);
      }
    }

    // Update the database
    const { data, error } = await supabase
      .from('players')
      .update({
        nft_holdings: nftHoldings,
        utc_timestamp: Math.floor(Date.now())
      })
      .eq('google_sub', googleSub)
      .select()
      .single();

    if (error) {
      console.error('Error removing card from deck:', error);
      return res.status(500).json({ error: 'Failed to remove card from deck' });
    }

    console.log(`✅ Card ${cardObjectId} removed from deck ${deckObjectId} for player ${googleSub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove deck card error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 