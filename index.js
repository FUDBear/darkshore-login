import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route for zkLogin (existing auth routes)
import authRoutes from './routes/auth.js';
app.use('/login', authRoutes);

// Route for player management
import playerRoutes from './routes/player.js';
app.use('/player', playerRoutes);

// Route for zkLogin prover
import zkLoginRoutes from './routes/zklogin.js';
app.use('/', zkLoginRoutes);

// Route for Walrus image uploads
import walrusRoutes from './routes/walrus.js';
app.use('/api/walrus', walrusRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Available endpoints:`);
  console.log(`   - GET  /login/google (Unity)`);
  console.log(`   - GET  /login/google/callback (Unity)`);
  console.log(`   - GET  /login/token (Unity)`);
  console.log(`   - GET  /login/react/google (React)`);
  console.log(`   - GET  /login/react/google/callback (React)`);
  console.log(`   - GET  /login/react/token (React)`);
  console.log(`   - POST /v1/zklogin`);
  console.log(`   - POST /v1/zklogin/submit`);
  console.log(`   - POST /player/init`);
  console.log(`   - GET  /player/state/:googleSub`);
  console.log(`   - PUT  /player/state/:googleSub`);
  console.log(`   - POST /player/sync-nfts`);
  console.log(`   - POST /player/add-deck-card`);
  console.log(`   - POST /player/remove-deck-card`);
  console.log(`   - POST /api/walrus/upload (Walrus image upload)`);
  console.log(`   - GET  /api/walrus/test (Walrus endpoint test)`);
});
